import assert from 'node:assert/strict';
import { createDb, startPgrestMock } from './pgrest-mock.mjs';
process.env.SUPABASE_URL = 'http://127.0.0.1:54328';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
process.env.SESSION_SECRET = 'validation-test-secret';
delete process.env.TELEGRAM_STAFF_CHAT_ID;
delete process.env.TELEGRAM_BOT_TOKEN;
const db = createDb({ users: [{ id: 'admin', role: 'admin' }] });
const server = await startPgrestMock(db, 54328);
const originalFetch = globalThis.fetch;
let hook = null;
globalThis.fetch = async (url, opts) => {
  assert(String(url).startsWith(process.env.SUPABASE_URL), 'External network blocked');
  if (hook) await hook(new URL(String(url)), opts);
  return originalFetch(url, opts);
};
const { default: handler } = await import('../api/reservations.js');
const { issueToken } = await import('../api/_lib/session.js');
const { reservationInstant } = await import('../src/booking/barTime.js');
const { TABLES, activeSeats } = await import('../src/booking/tablesConfig.js');
const base = { tableId: 'T1', date: '2099-10-12', timeFrom: '20:00', guestsCount: 2, guestName: 'Guest' };
async function api(method, body) {
  const res = { status(code) { this.code = code; return this; }, end(value) { this.value = JSON.parse(value); }, setHeader() {} };
  await handler({ method, headers: { authorization: 'Bearer ' + issueToken('admin') }, body, query: {} }, res);
  return res;
}
function reset() { hook = null; for (const t of ['reservations', 'table_occupancy', 'app_config']) db.t(t).length = 0; }
let failures = 0;
async function test(name, fn) { reset(); try { await fn(); console.log('PASS ' + name); } catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); } }
try {
  for (const guestsCount of [0, -1, 1.5, '2', {}, null, activeSeats(TABLES.find(t => t.id === base.tableId)) + 1]) await test('create rejects count ' + JSON.stringify(guestsCount), async () => {
    assert.equal((await api('POST', { ...base, guestsCount })).code, 400); assert.equal(db.t('reservations').length, 0);
  });
  for (const patch of [{ date: '2099-02-29' }, { date: '2099-2-01' }, { date: null }, { timeFrom: '25:00' }, { timeFrom: '20:15' }, { timeFrom: '16:30' }, { timeFrom: '01:30' }, { timeTo: null }, { timeTo: '25:00' }]) await test('create rejects ' + JSON.stringify(patch), async () => {
    assert.equal((await api('POST', { ...base, ...patch })).code, 400); assert.equal(db.t('reservations').length, 0);
  });
  for (const patch of [{ timeFrom: '17:00' }, { timeFrom: '01:00' }, { date: '2099-10-09', timeFrom: '16:00' }, { date: '2099-10-09', timeFrom: '03:00' }, { timeTo: '05:17' }]) await test('valid arrival/end ' + JSON.stringify(patch), async () => {
    const res = await api('POST', { ...base, ...patch }); assert.equal(res.code, 200); assert.equal(res.value.reservation.status, 'pending');
  });
  for (const updates of [{ guestsCount: 0 }, { guestsCount: -1 }, { guestsCount: 1.5 }, { guestsCount: '2' }, { guestsCount: {} }, { guestsCount: null }, { guestsCount: 100 }, { timeFrom: '25:00' }, { timeFrom: '20:15' }, { date: '2099-02-29' }, { timeTo: null }]) await test('PATCH rejects ' + JSON.stringify(updates), async () => {
    const created = await api('POST', base); const row = db.t('reservations')[0]; const snapshot = structuredClone(row);
    assert.equal((await api('PATCH', { id: created.value.reservation.id, action: 'update', updates })).code, 400); assert.deepEqual(row, snapshot);
  });
  await test('merged target respects smaller table override', async () => {
    const created = await api('POST', base);
    db.t('app_config').push({ key: 'table_config_v2', value: { T2: { seatsCount: 1 } } });
    assert.equal((await api('PATCH', { id: created.value.reservation.id, action: 'update', updates: { tableId: 'T2' } })).code, 400);
  });
  await test('transfer cannot move party enlarged after capacity validation', async () => {
    db.t('app_config').push({ key: 'table_config_v2', value: { T1: { seatsCount: 6 }, T2: { seatsCount: 4 } } });
    const created = await api('POST', base); const id = created.value.reservation.id;
    hook = async (url, opts) => {
      if (opts?.method === 'PATCH' && url.pathname.endsWith('/reservations')) {
        hook = null;
        assert.equal((await api('PATCH', { id, action: 'update', updates: { guestsCount: 5 } })).code, 200);
      }
    };
    assert.equal((await api('PATCH', { id, action: 'update', updates: { tableId: 'T2' } })).code, 400);
    assert.equal(db.t('reservations')[0].table_id, 'T1'); assert.equal(db.t('reservations')[0].guests_count, 5);
  });
  await test('default count and three-hour end retained', async () => {
    const payload = { ...base, timeFrom: '01:00' }; delete payload.guestsCount;
    const res = await api('POST', payload); assert.equal(res.code, 200);
    assert.equal(res.value.reservation.guestsCount, 2); assert.equal(res.value.reservation.timeTo, '04:00');
  });
  await test('server past-arrival grace accepts 30 minutes and rejects beyond', async () => {
    const originalNow = Date.now;
    try {
      Date.now = () => reservationInstant(base.date, base.timeFrom).getTime() + 30 * 60000;
      assert.equal((await api('POST', base)).code, 200);
      reset(); Date.now = () => reservationInstant(base.date, base.timeFrom).getTime() + 30 * 60000 + 1;
      assert.equal((await api('POST', base)).code, 400); assert.equal(db.t('reservations').length, 0);
    } finally { Date.now = originalNow; }
  });
  await test('count override and legacy unrelated edit preserved', async () => {
    db.t('app_config').push({ key: 'table_config_v2', value: { T1: { seatsCount: 8 } } });
    const created = await api('POST', { ...base, guestsCount: 8 }); assert.equal(created.code, 200);
    const row = db.t('reservations')[0]; row.date = '2000-01-01'; row.time_from = '20:15'; row.guests_count = 99;
    assert.equal((await api('PATCH', { id: row.id, action: 'update', updates: { guestName: 'Edited' } })).code, 200);
    assert.equal((await api('PATCH', { id: row.id, action: 'update', updates: { guestsCount: 8 } })).code, 200);
  });
} finally { await new Promise(resolve => server.close(resolve)); globalThis.fetch = originalFetch; }
assert.equal(failures, 0, `${failures} validation regressions failed`);
