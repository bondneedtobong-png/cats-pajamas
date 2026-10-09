// Real auth handlers/session helpers against isolated in-memory PostgREST only.
// Run: node devtools/auth_security_test.mjs (never loads .env or starts the bot).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createDb, startPgrestMock } from './pgrest-mock.mjs';
import { build } from 'esbuild';

process.env.SUPABASE_URL = 'http://127.0.0.1:54328';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'auth-test-only';
process.env.SESSION_SECRET = 'auth-test-secret-at-least-32-characters';
process.env.SESSION_VERSION = '2026-10-auth-test';
process.env.TELEGRAM_ADMIN_IDS = '111';
process.env.TELEGRAM_STAFF_IDS = '555';
process.env.TELEGRAM_OWNER_ID = '111';
process.env.PUBLIC_SITE_URL = 'http://localhost:5173';
process.env.TELEGRAM_BOT_USERNAME = 'local_test_bot';
delete process.env.AUTH_DEMO_OTP;
process.env.NODE_ENV = 'development';
const db = createDb({ users: [
  { id: 'guest', phone: '79990000001', role: 'guest' },
  { id: 'admin', phone: '79990000002', role: 'admin', telegram_id: '111' },
  { id: 'staff', phone: '79990000003', role: 'guest', telegram_id: '555' },
] });
const server = await startPgrestMock(db, 54328);
// Refuse every unexpected network destination, including Telegram/production.
const fetchReal = globalThis.fetch;
globalThis.fetch = (url, opts) => {
  assert.equal(new URL(String(url)).origin, 'http://127.0.0.1:54328', 'external network forbidden');
  return fetchReal(url, opts);
};
const { default: handler } = await import('../api/auth.js');
const auth = await import('../api/_lib/auth.js');
const session = await import('../api/_lib/session.js');
const originalLog = console.log;
const originalError = console.error;
const logs = [];
console.log = (...args) => logs.push(args.join(' '));
console.error = (...args) => logs.push(args.join(' '));
async function call(body, token = '') {
  let status = 200, payload;
  await handler({ method: 'POST', headers: { authorization: token ? `Bearer ${token}` : '' }, body }, {
    status(n) { status = n; return this; }, setHeader() { return this; },
    end(s) { payload = s ? JSON.parse(s) : {}; },
  });
  return { status, ...payload };
}
let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; originalLog('PASS ' + name); }
  catch (e) { failed++; originalLog('FAIL ' + name + ': ' + e.message); }
}
const realNow = Date.now;
try {
  await test('mock OTP is disabled by default at both endpoints', async () => {
    assert.equal((await call({ action: 'request_otp', phone: '79990000001' })).status, 403);
    db.t('otps').push({ phone: '79990000001', code: '1234', expires_at: new Date(realNow() + 60000).toISOString() });
    assert.equal((await call({ action: 'verify_otp', phone: '79990000001', code: '1234' })).status, 403);
  });
  await test('production rejects demo opt-in', async () => {
    process.env.NODE_ENV = 'production'; process.env.AUTH_DEMO_OTP = 'true';
    assert.equal((await call({ action: 'request_otp', phone: '79990000001' })).status, 403);
  });
  await test('demo rejects nonlocal configuration', async () => {
    process.env.NODE_ENV = 'development'; process.env.PUBLIC_SITE_URL = 'https://example.com';
    assert.equal((await call({ action: 'request_otp', phone: '79990000001' })).status, 403);
    process.env.PUBLIC_SITE_URL = 'http://localhost:5173';
  });
  await test('normal UI options expose Telegram only', async () => {
    delete process.env.AUTH_DEMO_OTP;
    const r = await call({ action: 'login_options' });
    assert.equal(r.status, 200); assert.equal(r.demoOtpEnabled, false);
    process.env.AUTH_DEMO_OTP = 'true';
  });
  await test('local demo cannot access admin or Telegram-linked staff', async () => {
    for (const phone of ['79990000002', '79990000003']) {
      assert.equal((await call({ action: 'request_otp', phone })).status, 403);
      db.t('otps').push({ phone, code: '1234', expires_at: new Date(realNow() + 60000).toISOString() });
      assert.equal((await call({ action: 'verify_otp', phone, code: '1234' })).status, 403);
    }
  });
  await test('explicit local demo authenticates guest once without logging OTP', async () => {
    logs.length = 0;
    const r = await call({ action: 'request_otp', phone: '79990000001' });
    assert.equal(r.status, 200); assert.match(r.devCode, /^\d{4}$/);
    const verified = await call({ action: 'verify_otp', phone: '79990000001', code: r.devCode });
    assert.equal(verified.status, 200); assert.equal(verified.user.id, 'guest');
    assert.notEqual((await call({ action: 'verify_otp', phone: '79990000001', code: r.devCode })).status, 200);
    assert.equal(logs.some(l => l.includes(r.devCode) || l.includes(verified.token)), false);
  });
  await test('legacy deterministic sessions are rejected', () => {
    const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update('admin').digest('hex');
    assert.equal(session.verifyToken('admin.' + sig), null);
  });
  await test('session expiration is finite and enforced', () => {
    process.env.SESSION_TTL_SECONDS = '60';
    const token = session.issueToken('guest');
    assert.equal(session.verifyToken(token), 'guest');
    Date.now = () => realNow() + 61000;
    try { assert.equal(session.verifyToken(token), null); } finally { Date.now = realNow; }
  });
  await test('session version rotation invalidates existing sessions', () => {
    const token = session.issueToken('guest');
    const version = process.env.SESSION_VERSION;
    process.env.SESSION_VERSION = 'revoked';
    try { assert.equal(session.verifyToken(token), null); } finally { process.env.SESSION_VERSION = version; }
  });
  await test('tampered signature and payload never resolve a user', () => {
    const token = session.issueToken('guest');
    assert.equal(session.verifyToken(token.slice(0, -1) + '!'), null);
    assert.equal(session.verifyToken(token.replace('cp1.', 'cp0.')), null);
    assert.equal(session.verifyToken(token.slice(0, -64) + 'я'.repeat(64)), null);
    assert.equal(session.verifyToken(token.slice(0, -64) + 'g'.repeat(64)), null);
  });
  await test('signature covers user identity and expiration', () => {
    const token = session.issueToken('guest');
    const parts = token.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    claims.sub = 'admin'; claims.exp += 3600;
    parts[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
    assert.equal(session.verifyToken(parts.join('.')), null);
  });
  await test('invalid TTL refuses issuance rather than unlimited sessions', () => {
    for (const ttl of ['0', '-1', 'Infinity', '2592001', 'invalid']) {
      process.env.SESSION_TTL_SECONDS = ttl;
      assert.throws(() => session.issueToken('guest'));
    }
    process.env.SESSION_TTL_SECONDS = '60';
  });
  await test('startup validation rejects missing secret, short production key and invalid TTL', () => {
    const secret = process.env.SESSION_SECRET;
    assert.equal(typeof session.assertSessionConfigured, 'function');
    delete process.env.SESSION_SECRET;
    try { assert.throws(() => session.assertSessionConfigured()); }
    finally { process.env.SESSION_SECRET = secret; }
    process.env.NODE_ENV = 'production'; process.env.SESSION_SECRET = 'short';
    try { assert.throws(() => session.assertSessionConfigured()); }
    finally { process.env.NODE_ENV = 'development'; process.env.SESSION_SECRET = secret; }
    process.env.SESSION_TTL_SECONDS = '0';
    try { assert.throws(() => session.assertSessionConfigured()); }
    finally { process.env.SESSION_TTL_SECONDS = '60'; }
    assert.doesNotThrow(() => session.assertSessionConfigured());
  });
  await test('secret rotation invalidates existing sessions', () => {
    const token = session.issueToken('guest'); const secret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'another-strong-test-secret-at-least-32-bytes';
    try { assert.equal(session.verifyToken(token), null); } finally { process.env.SESSION_SECRET = secret; }
  });
  await test('missing production secret fails closed', () => {
    process.env.NODE_ENV = 'production'; const secret = process.env.SESSION_SECRET;
    const token = session.issueToken('guest'); delete process.env.SESSION_SECRET;
    try { assert.equal(session.verifyToken(token), null); assert.throws(() => session.issueToken('guest')); }
    finally { process.env.SESSION_SECRET = secret; process.env.NODE_ENV = 'development'; }
  });
  await test('expired completed Telegram login cannot issue a session', async () => {
    db.t('web_login_tokens').push({ token: 'expired', status: 'completed', session_token: session.issueToken('guest'), expires_at: new Date(realNow() - 86400000).toISOString() });
    const r = await call({ action: 'check_telegram_login', token: 'expired' });
    assert.equal(r.status, 'expired'); assert.equal(r.token, undefined);
  });
  await test('concurrent completed polling issues exactly one session', async () => {
    db.t('web_login_tokens').push({ token: 'race', status: 'completed', session_token: session.issueToken('guest'), expires_at: new Date(realNow() + 60000).toISOString() });
    const results = await Promise.all([call({ action: 'check_telegram_login', token: 'race' }), call({ action: 'check_telegram_login', token: 'race' })]);
    assert.equal(results.filter(r => r.status === 'completed' && r.token).length, 1);
  });
  await test('concurrent Telegram completion accepts one identity only', async () => {
    db.t('web_login_tokens').push({ token: 'complete-race', status: 'pending', expires_at: new Date(realNow() + 60000).toISOString() });
    const results = await Promise.allSettled([
      auth.completeLoginToken('complete-race', { id: 777, first_name: 'One' }, ''),
      auth.completeLoginToken('complete-race', { id: 778, first_name: 'Two' }, ''),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  });
  await test('invalid session receives 401 on me', async () => {
    assert.equal((await call({ action: 'me' }, 'invalid')).status, 401);
  });
  // Execute the actual browser service with controlled browser storage/network.
  const clientBundle = await build({ entryPoints: [new URL('../src/auth/AuthService.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], bundle: true, write: false, format: 'esm', define: { 'import.meta.env.VITE_API_BASE': '""' }, logLevel: 'silent' });
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const authEvents = [];
  globalThis.window = { dispatchEvent: event => authEvents.push(event.type) };
  globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
  const { default: client } = await import('data:text/javascript;base64,' + Buffer.from(clientBundle.outputFiles[0].text).toString('base64'));
  await test('legacy rejection clears client storage and notifies mounted UI', async () => {
    storage.set('cpjc_token', 'legacy-token'); storage.set('cpjc_user', '{"id":"admin","role":"admin"}');
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Не авторизован' }), { status: 401 });
    await client.refresh();
    assert.equal(client.getCurrentUser(), null); assert.equal(client.isAuthenticated(), false);
    assert.equal(storage.has('cpjc_token'), false); assert.equal(storage.has('cpjc_user'), false);
    assert.ok(authEvents.includes('cpjc-auth-changed'));
  });
  await test('late unauthorized response does not clear newer login', async () => {
    storage.set('cpjc_token', 'old-token'); storage.set('cpjc_user', '{"id":"guest","role":"guest"}');
    globalThis.fetch = async () => {
      storage.set('cpjc_token', 'new-token');
      return new Response('{}', { status: 401 });
    };
    await client.refresh(); assert.equal(storage.get('cpjc_token'), 'new-token');
  });
  await test('logout clears identity and notifies mounted UI', () => {
    authEvents.length = 0; client.logout();
    assert.equal(storage.size, 0); assert.ok(authEvents.includes('cpjc-auth-changed'));
  });
} finally {
  Date.now = realNow; console.log = originalLog; console.error = originalError;
  globalThis.fetch = fetchReal;
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
originalLog(`AUTH SECURITY: ${passed} PASS, ${failed} FAIL`);
process.exitCode = failed ? 1 : 0;
