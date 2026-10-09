// Isolated regression tests: real booking/API/bot logic, in-memory PostgREST.
import { createDb, startPgrestMock } from './pgrest-mock.mjs';
import { createRequire } from 'node:module';
process.env.SUPABASE_URL = 'http://127.0.0.1:54327';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
process.env.SESSION_SECRET = 'booking-regression-secret';
process.env.TELEGRAM_BOT_TOKEN = '999:test';
delete process.env.TELEGRAM_STAFF_CHAT_ID;
delete process.env.ALLOW_DEMO_PAYMENTS;
process.env.NODE_ENV = 'test';
const db = createDb({ users: [
  { id: 'owner', telegram_id: '222', role: 'guest', name: 'Owner' },
  { id: 'other', telegram_id: '333', role: 'guest', name: 'Other' },
  { id: 'admin', telegram_id: '444', role: 'admin', name: 'Admin' },
] });
const server = await startPgrestMock(db, 54327);
const realFetch = globalThis.fetch;
let hook = null;
const telegramCalls = [];
const fakeTelegram = async (url, opts) => {
  const method = String(url).split('/').pop();
  const body = typeof opts?.body === 'string' ? JSON.parse(opts.body) : {};
  telegramCalls.push({ method, body });
  const result = method === 'getMe' ? { id: 999, is_bot: true, first_name: 'Test', username: 'test_bot' }
    : { message_id: 1, chat: { id: body.chat_id }, date: 0 };
  return new Response(JSON.stringify({ ok: true, result }), { headers: { 'Content-Type': 'application/json' } });
};
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.telegram.org')) return fakeTelegram(url, opts);
  if (!String(url).startsWith(process.env.SUPABASE_URL)) throw new Error('External network blocked');
  if (hook) await hook(new URL(String(url)), opts);
  return realFetch(url, opts);
};
const req = createRequire(new URL('../node_modules/grammy/out/shim.node.js', import.meta.url));
const nf = req.resolve('node-fetch');
fakeTelegram.default = fakeTelegram;
req.cache[nf] = { id: nf, filename: nf, loaded: true, exports: fakeTelegram };
const bk = await import('../api/_lib/booking.js');
const { guestComposer } = await import('../api/bot/guest.js');
const { staffReservationsComposer, performReject } = await import('../api/bot/staffReservations.js');
const { Bot } = await import('grammy');
const { default: handler } = await import('../api/reservations.js');
const { issueToken } = await import('../api/_lib/session.js');
let fails = 0;
async function test(name, fn) {
  hook = null;
  db.t('reservations').length = 0;
  db.t('table_occupancy').length = 0;
  db.t('app_config').length = 0;
  try { await fn(); console.log('PASS ' + name); }
  catch (e) { fails++; console.log('FAIL ' + name + ': ' + e.message); }
}
function assert(value, msg) { if (!value) throw new Error(msg); }
async function rejects(fn) { let failed = false; try { await fn(); } catch { failed = true; } assert(failed, 'operation unexpectedly succeeded'); }
function seed(status = 'confirmed', extra = {}) {
  const row = { id: 'r1', table_id: 'T1', guest_id: 'owner', status, date: '2099-10-11', time_from: '20:00', time_to: '23:00', guests_count: 2, guest_name: 'Owner', source: 'web', deposit_price: 1000, deposit_status: 'pending', created_at: new Date().toISOString(), ...extra };
  db.t('reservations').push(row); return row;
}
function beforeReservationPatch(fn) {
  hook = async (url, opts) => {
    if (opts?.method === 'PATCH' && url.pathname.endsWith('/reservations')) { hook = null; await fn(); }
  };
}
try {
  await test('expiry cannot overwrite concurrent confirmation', async () => {
    const row = seed('pending', { created_at: '2000-01-01T00:00:00Z' });
    beforeReservationPatch(() => { row.status = 'confirmed'; });
    const result = await bk.getReservations();
    assert(row.status === 'confirmed', 'confirmed reservation expired');
    assert(result[0].status === 'confirmed', 'stale read presented as cancelled/pending');
  });
  await test('expiry cannot cancel reservation transferred after stale arrival snapshot', async () => {
    const row = seed('pending', { date: '2000-01-01', time_from: '20:00' });
    beforeReservationPatch(() => bk.updateReservation('r1', { date: '2099-10-12', timeFrom: '22:00', tableId: 'T2' }));
    const result = await bk.getReservations();
    assert(row.date === '2099-10-12' && row.time_from === '22:00' && row.table_id === 'T2', 'real transfer failed');
    assert(row.status === 'pending', 'future reservation cancelled by stale expiry snapshot');
    assert(result[0].status === 'pending' && result[0].date === row.date, 'returned snapshot was not refreshed');
  });
  await test('date and table filtered lists exclude concurrently moved reservation', async () => {
    seed('pending', { date: '2000-01-01', time_from: '20:00' });
    beforeReservationPatch(() => bk.updateReservation('r1', { date: '2099-10-12', timeFrom: '22:00', tableId: 'T2' }));
    const result = await bk.getReservations({ date: '2000-01-01', tableId: 'T1' });
    assert(result.length === 0, 'moved reservation remains in old date/table list');
  });
  await test('pending filtered list excludes concurrently confirmed reservation', async () => {
    const row = seed('pending', { created_at: '2000-01-01T00:00:00Z' });
    beforeReservationPatch(() => { row.status = 'confirmed'; });
    const result = await bk.getReservations({ status: 'pending' });
    assert(result.length === 0, 'confirmed reservation remains in pending list');
  });
  await test('deleted reservation is removed after failed expiry CAS', async () => {
    seed('pending', { created_at: '2000-01-01T00:00:00Z' });
    beforeReservationPatch(() => { db.t('reservations').length = 0; });
    const result = await bk.getReservations();
    assert(result.length === 0, 'deleted reservation remains in response');
  });
  await test('status CAS cannot revive concurrent cancellation', async () => {
    const row = seed(); beforeReservationPatch(() => { row.status = 'cancelled'; });
    await rejects(() => bk.updateReservationStatus('r1', 'seated'));
    assert(row.status === 'cancelled', 'cancelled reservation revived');
    assert(!db.t('table_occupancy').length, 'occupancy opened after failed CAS');
  });
  await test('generic update cannot bypass status transitions', async () => {
    const row = seed('completed');
    await rejects(() => bk.updateReservation('r1', { status: 'confirmed' }));
    assert(row.status === 'completed', 'final reservation revived');
  });
  await test('pending cannot jump directly to completed', async () => {
    const row = seed('pending'); await rejects(() => bk.updateReservationStatus('r1', 'completed'));
    assert(row.status === 'pending', 'invalid transition written');
  });
  await test('guest cannot cancel foreign reservation', async () => {
    const row = seed(); await rejects(() => bk.cancelReservation('r1', '', { guestId: 'other' }));
    assert(row.status === 'confirmed', 'foreign reservation cancelled');
  });
  await test('guest ownership checked at cancellation UPDATE', async () => {
    const row = seed(); beforeReservationPatch(() => { row.guest_id = 'other'; });
    await rejects(() => bk.cancelReservation('r1', '', { guestId: 'owner' }));
    assert(row.status === 'confirmed', 'ownership race cancelled foreign reservation');
  });
  await test('guest cannot cancel seated or completed', async () => {
    seed('seated'); await rejects(() => bk.cancelReservation('r1', '', { guestId: 'owner' }));
    db.t('reservations')[0].status = 'completed'; await rejects(() => bk.cancelReservation('r1', '', { staffOverride: true }));
  });
  await test('real Telegram callback rejects foreign cancellation without success edit', async () => {
    const row = seed(); telegramCalls.length = 0;
    const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
    bot.use((ctx, next) => { ctx.session = {}; return next(); }); bot.use(guestComposer);
    await bot.init();
    await bot.handleUpdate({ update_id: 1, callback_query: { id: 'cb', chat_instance: 'ci', from: { id: 333, first_name: 'Other', is_bot: false }, message: { message_id: 1, date: 0, text: 'test', chat: { id: 333, type: 'private' } }, data: 'myx:r1' } });
    assert(row.status === 'confirmed', 'callback cancelled foreign reservation');
    assert(!telegramCalls.some(c => c.method === 'editMessageText' && c.body.text === 'Бронь отменена.'), 'success edit after rejected callback');
  });
  await test('demo payment disabled by default', async () => {
    const row = seed(); await rejects(() => bk.payDeposit('r1', { guestId: 'owner' }));
    assert(row.deposit_status === 'pending', 'mock marked paid by default');
  });
  await test('production cannot enable demo payments', async () => {
    seed(); process.env.ALLOW_DEMO_PAYMENTS = 'true'; process.env.NODE_ENV = 'production';
    try { await rejects(() => bk.payDeposit('r1', { guestId: 'owner' })); }
    finally { process.env.NODE_ENV = 'test'; delete process.env.ALLOW_DEMO_PAYMENTS; }
  });
  await test('missing environment cannot enable demo payments', async () => {
    seed(); process.env.ALLOW_DEMO_PAYMENTS = 'true'; delete process.env.NODE_ENV;
    try { await rejects(() => bk.payDeposit('r1', { guestId: 'owner' })); }
    finally { process.env.NODE_ENV = 'test'; delete process.env.ALLOW_DEMO_PAYMENTS; }
  });
  await test('opted-in demo is explicit and repeated payment is rejected', async () => {
    const row = seed(); process.env.ALLOW_DEMO_PAYMENTS = 'true';
    try {
      const result = await bk.payDeposit('r1', { guestId: 'owner' });
      assert(result.depositStatus === 'paid_mock' && result.demoPaymentAvailable && result.status === 'confirmed', 'demo result wrong');
      assert(bk.staffBookingText(result).includes('демо, деньги не получены'), 'staff mock label omitted');
      const tx = row.deposit_transaction_id;
      await rejects(() => bk.payDeposit('r1', { guestId: 'owner' }));
      assert(row.deposit_transaction_id === tx, 'repeat overwrote transaction');
    } finally { delete process.env.ALLOW_DEMO_PAYMENTS; }
  });
  await test('demo UPDATE checks ownership and current status', async () => {
    const row = seed(); process.env.ALLOW_DEMO_PAYMENTS = 'true';
    try {
      beforeReservationPatch(() => { row.guest_id = 'other'; });
      await rejects(() => bk.payDeposit('r1', { guestId: 'owner' }));
      assert(row.deposit_status === 'pending', 'foreign payment race wrote deposit');
      row.guest_id = 'owner';
      beforeReservationPatch(() => { row.status = 'cancelled'; });
      await rejects(() => bk.payDeposit('r1', { guestId: 'owner' }));
      assert(row.deposit_status === 'pending', 'cancelled payment race wrote deposit');
    } finally { delete process.env.ALLOW_DEMO_PAYMENTS; }
  });
  await test('mock cancellation cannot claim a financial refund', async () => {
    const row = seed('confirmed', { deposit_status: 'paid_mock' });
    await bk.cancelReservation('r1', '', { guestId: 'owner' });
    assert(row.deposit_status === 'paid_mock', 'demo became financial refund/retention');
  });
  await test('HTTP guest payment denied when disabled', async () => {
    const row = seed(); let response;
    const res = { setHeader() { return this; }, status(code) { this.code = code; return this; }, end(body) { response = { code: this.code, body: JSON.parse(body) }; return this; } };
    await handler({ method: 'PATCH', headers: { authorization: 'Bearer ' + issueToken('owner') }, body: { id: 'r1', action: 'pay' }, query: {} }, res);
    assert(response.code === 403, 'HTTP payment not forbidden'); assert(row.deposit_status === 'pending', 'payment status changed');
  });
  await test('seated transfer fails closed and preserves occupancy', async () => {
    const row = seed('seated'); db.t('table_occupancy').push({ id: 'o1', table_id: 'T1', reservation_id: 'r1', source: 'reservation', freed_at: null });
    await rejects(() => bk.updateReservation('r1', { tableId: 'T2' }));
    assert(row.table_id === 'T1', 'seated table changed');
  });
  await test('transfer rejects blocked target date', async () => {
    seed(); db.t('app_config').push({ key: 'booking_dates', value: { blockedDates: ['2099-10-12'] } });
    await rejects(() => bk.updateReservation('r1', { date: '2099-10-12' }));
  });
  await test('transfer rejects unknown target table', async () => {
    seed(); await rejects(() => bk.updateReservation('r1', { tableId: 'fake' }));
  });
  await test('transfer cannot move concurrently seated reservation', async () => {
    const row = seed(); beforeReservationPatch(() => { row.status = 'seated'; });
    await rejects(() => bk.updateReservation('r1', { tableId: 'T2' }));
    assert(row.table_id === 'T1', 'transfer bypassed seated race');
  });
  await test('walk-in helpers cannot create or close reservation occupancy', async () => {
    await rejects(() => bk.setTableOccupied('T1', { source: 'reservation', reservationId: 'r1' }));
    db.t('table_occupancy').push({ id: 'occ1', table_id: 'T1', source: 'reservation', reservation_id: 'r1', freed_at: null });
    await rejects(() => bk.freeTableOccupancy('T1'));
    assert(db.t('table_occupancy')[0].freed_at == null, 'reservation occupancy closed directly');
  });
  await test('status mutation leaves occupancy to the DB transaction', async () => {
    seed();
    hook = async (url, opts) => {
      if (url.pathname.endsWith('/table_occupancy') && ['POST', 'PATCH'].includes(opts?.method)) {
        throw new Error('separate occupancy mutation');
      }
    };
    await bk.updateReservationStatus('r1', 'seated', { fromStatus: 'confirmed' });
    await bk.updateReservationStatus('r1', 'completed', { fromStatus: 'seated' });
    seed('confirmed', { id: 'r2' });
    await bk.cancelReservation('r2', '', { guestId: 'owner' });
  });
  await test('manual status and cancellation reject concurrently transferred snapshot', async () => {
    for (const action of [() => bk.updateReservationStatus('r1', 'seated'), () => bk.cancelReservation('r1', '', { guestId: 'owner' })]) {
      db.t('reservations').length = 0;
      const row = seed();
      beforeReservationPatch(() => { row.table_id = 'T2'; row.date = '2099-10-12'; });
      await rejects(action);
      assert(row.status === 'confirmed', 'stale mutation changed transferred reservation');
    }
  });
  await test('old automatic seating snapshot cannot seat transferred date/time/table', async () => {
    for (const field of ['date', 'time_from', 'table_id']) {
      db.t('reservations').length = 0;
      const row = seed(); const changes = { date: '2099-10-12', time_from: '22:00', table_id: 'T2' };
      beforeReservationPatch(() => { row[field] = changes[field]; });
      await rejects(() => bk.updateReservationStatus('r1', 'seated', { fromStatus: 'confirmed', expectedDate: '2099-10-11', expectedTimeFrom: '20:00', expectedTableId: 'T1' }));
      assert(row.status === 'confirmed', `stale ${field} seated reservation`);
    }
  });
  await test('stale rejection cannot cancel confirmed or seated; explicit confirmed cancellation works', async () => {
    const row = seed(); await rejects(() => performReject('r1', 'Staff', 'Test'));
    row.status = 'seated'; await rejects(() => performReject('r1', 'Staff', 'Test'));
    row.status = 'confirmed'; await performReject('r1', 'Staff', 'Test', 'confirmed');
    assert(row.status === 'cancelled', 'explicit confirmed cancellation failed');
  });
  await test('real staff quick/custom callbacks reject stale pending actions', async () => {
    process.env.TELEGRAM_STAFF_IDS = '555';
    const row = seed(); const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
    let session = {};
    bot.use((ctx, next) => { ctx.session = session; return next(); }); bot.use(staffReservationsComposer); await bot.init();
    const from = { id: 555, first_name: 'Staff', is_bot: false };
    await bot.handleUpdate({ update_id: 2, callback_query: { id: 'stcb', chat_instance: 'ci', from, message: { message_id: 1, date: 0, text: 'test', chat: { id: -100500, type: 'supergroup' } }, data: 'stnor:r1:nomest' } });
    assert(row.status === 'confirmed', 'quick rejection cancelled confirmed');
    row.status = 'seated'; session = { step: 'st_reject_reason', draft: { rejectId: 'r1', promptId: 1 } };
    await bot.handleUpdate({ update_id: 3, message: { message_id: 2, date: 0, text: 'Closed', from, chat: { id: -100500, type: 'supergroup' }, reply_to_message: { message_id: 1, date: 0, chat: { id: -100500, type: 'supergroup' } } } });
    assert(row.status === 'seated', 'custom rejection cancelled seated');
  });
  await test('guest cancellation still succeeds', async () => {
    const row = seed(); await bk.cancelReservation('r1', 'Guest', { guestId: 'owner' }); assert(row.status === 'cancelled', 'own cancellation failed');
  });
  await test('explicit staff cancellation still succeeds', async () => {
    const row = seed('pending'); await bk.cancelReservation('r1', 'Staff', { staffOverride: true, fromStatus: 'pending' }); assert(row.status === 'cancelled', 'staff cancellation failed');
  });
  console.log(`${fails ? 'FAILED' : 'ALL PASS'} (${fails} failures)`);
} finally { hook = null; await new Promise(resolve => server.close(resolve)); }
process.exitCode = fails ? 1 : 0;
