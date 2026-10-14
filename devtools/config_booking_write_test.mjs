// Real config mutation functions; an in-memory database enforces revision CAS.
// No credentials, requests, or database connection.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TABLES, activeSeats } from '../src/booking/tablesConfig.js';
globalThis.fetch = () => { throw new Error('Network forbidden'); };
let rows = {}, failRead = false, failWrite = false, alwaysConflict = false, writes = 0;
const copy = x => structuredClone(x);
const db = { from(table) {
  assert.equal(table, 'app_config');
  let mode = 'read', patch, key, revision;
  const q = {
    select() { return q; }, eq(field, value) { if (field === 'key') key = value; else { assert.equal(field, 'revision'); assert.equal(typeof value, 'number'); revision = value; } return q; },
    insert(value) { mode = 'insert'; patch = value; key = value.key; return q; }, update(value) { mode = 'update'; patch = value; return q; },
    async single() { return execute(); }, async maybeSingle() { return execute(); },
  };
  function execute() {
    if (mode === 'read') return failRead ? { error: { message: 'read failed' } } : { data: rows[key] ? copy(rows[key]) : null };
    writes++;
    if (failWrite) return { error: { message: 'write failed' } };
    if (mode === 'insert' && rows[key]) return { error: { code: '23505' } };
    if (mode === 'update' && (alwaysConflict || rows[key]?.revision !== revision)) return { data: null };
    rows[key] = { value: copy(patch.value), revision: (rows[key]?.revision ?? -1) + 1 };
    return { data: { key, revision: rows[key].revision } };
  }
  return q;
} };
const helperSource = (await readFile(new URL('../api/_lib/configWrite.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
const { patchConfig, configConflict } = new Function('supabase', `${helperSource}; return { patchConfig, configConflict };`)(db);
const bookingSource = await readFile(new URL('../api/_lib/booking.js', import.meta.url), 'utf8');
const dates = bookingSource.slice(bookingSource.indexOf('export async function setBookingDatesConfig'), bookingSource.indexOf('function tomorrowEveningDate'));
const tables = bookingSource.slice(bookingSource.indexOf('export async function setTableConfig'), bookingSource.indexOf('// ─── Текстовые заявки'));
const fns = new Function('patchConfig', 'configConflict', 'TABLES', 'activeSeats', `const BOOKING_DATES_KEY = 'booking_dates', TABLE_CONFIG_KEY = 'table_config_v2'; ${dates.replace(/export /g, '')} ${tables.replace(/export /g, '')}; return { setBookingDatesConfig, setTableConfig, setTableSeatActive };`)(patchConfig, configConflict, TABLES, activeSeats);
const [a, b] = TABLES;
await Promise.all([fns.setTableConfig(a.id, { depositPrice: 100 }), fns.setTableConfig(b.id, { seatsCount: 9 })]);
assert.equal(rows.table_config_v2.value[a.id].depositPrice, 100);
assert.equal(rows.table_config_v2.value[b.id].seatsCount, 9);
await Promise.all([fns.setTableConfig(a.id, { depositPrice: 200 }), fns.setTableConfig(a.id, { seatsCount: 8 })]);
assert.deepEqual(rows.table_config_v2.value[a.id], { depositPrice: 200, seatsCount: 8 });
const sameField = await Promise.allSettled([fns.setTableConfig(a.id, { depositPrice: 300 }), fns.setTableConfig(a.id, { depositPrice: 400 })]);
assert.equal(sameField.filter(s => s.status === 'fulfilled').length, 1);
assert.equal(sameField.find(s => s.status === 'rejected').reason.status, 409);
await assert.rejects(fns.setTableConfig(a.id, { depositPrice: 900, seatsCount: 12 }, { depositPrice: 200, seatsCount: 8 }), e => e.status === 409);
assert.equal(rows.table_config_v2.value[a.id].seatsCount, 8, 'conflicting atomic table save changes neither field');
await Promise.all([fns.setBookingDatesConfig({ blockToday: true }), fns.setBookingDatesConfig({ blockTomorrow: true }), fns.setBookingDatesConfig({ addDate: '2026-12-12' }), fns.setBookingDatesConfig({ addDate: '2026-12-13' })]);
assert.deepEqual(rows.booking_dates.value, { blockToday: true, blockTomorrow: true, blockedDates: ['2026-12-12', '2026-12-13'] });
await Promise.all([fns.setBookingDatesConfig({ removeDate: '2026-12-12' }), fns.setBookingDatesConfig({ addDate: '2026-12-14' })]);
assert.deepEqual(rows.booking_dates.value.blockedDates, ['2026-12-13', '2026-12-14']);
await assert.rejects(fns.setBookingDatesConfig({ blockToday: false }, { blockToday: false }), e => e.status === 409);
await assert.rejects(fns.setBookingDatesConfig({ removeDate: '2026-12-13' }, { dateBlocked: false }), e => e.status === 409);
const before = copy(rows);
failRead = true; const beforeWrites = writes;
await assert.rejects(fns.setTableConfig(a.id, { depositPrice: 1 }), /read failed/);
assert.equal(writes, beforeWrites); failRead = false;
failWrite = true;
await assert.rejects(fns.setBookingDatesConfig({ blockToday: false }), /write failed/);
assert.deepEqual(rows, before); failWrite = false;
alwaysConflict = true;
await assert.rejects(fns.setTableConfig(a.id, { depositPrice: 1 }), e => e.status === 409);
alwaysConflict = false;
assert.deepEqual(rows, before);
console.log('PASS insert race, different tables/fields/dates, same-field/stale UI conflicts, atomic table patch, read/write failures, bounded CAS retry');
// Execute the actual table editor callback: one atomic call, no success on failure.
const uiSource = await readFile(new URL('../src/admin/AdminPage.jsx', import.meta.url), 'utf8');
const panelStart = uiSource.indexOf('function TableEditorPanel(');
const saveStart = uiSource.indexOf('  async function handleSave(e)', panelStart);
const saveEnd = uiSource.indexOf('  const title =', saveStart);
let saving = false, success = 0, refreshed = 0, errors = [], payload;
const handleSave = new Function('setSaving', 'BookingService', 'table', 'price', 'seats', 'toast', 'onSaved', `${uiSource.slice(saveStart, saveEnd)}; return handleSave;`)(
  value => { saving = value; },
  { setTableConfig: async (...args) => { payload = args; throw new Error('stale settings'); } },
  { id: a.id, depositPrice: 200, activeSeatsCount: 8 }, '500', '12',
  { success: () => { success++; }, error: message => { errors.push(message); } }, () => { refreshed++; });
await handleSave({ preventDefault() {} });
assert.deepEqual(payload, [a.id, { depositPrice: 500, seatsCount: 12 }, { depositPrice: 200, seatsCount: 8 }]);
assert.equal(saving, false);
assert.equal(success, 0);
assert.equal(refreshed, 0);
assert.deepEqual(errors, ['stale settings']);
assert.match(uiSource, /if \(await apply\(\{ addDate: newDate \}, 'Дата закрыта для брони'\)\) setNewDate\(''\)/);
console.log('PASS actual table editor atomic baseline and failure UI; failed date draft is retained');
