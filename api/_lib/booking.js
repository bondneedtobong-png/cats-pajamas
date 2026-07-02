import { supabase } from './supabase.js';
import { TABLES, activeSeats } from '../../src/booking/tablesConfig.js';
import { BOOKING_RULES } from '../../src/booking/bookingRules.js';
import { awardVisitPoints } from './loyalty.js';

// Server-side mirror of src/booking/BookingService.js, backed by Supabase.
// Same business logic, channel-agnostic (web + telegram + admin call the same fns).

const TABLE_CONFIG_KEY = 'table_config';

// Guests who open the deposit-payment step but never finish (closed tab, changed
// mind) would otherwise leave the table looking "reserved" forever — nobody else
// checks in DB directly, they only see it through getReservations(). So the
// self-healing check lives there: every read that turns up a 'pending' row past
// this window auto-cancels it, freeing the table for the next guest.
const PENDING_PAYMENT_TIMEOUT_MS = 10 * 60 * 1000;

async function expireStalePending(rows) {
  const cutoff = Date.now() - PENDING_PAYMENT_TIMEOUT_MS;
  const stale = rows.filter(r => r.status === 'pending' && new Date(r.createdAt).getTime() < cutoff);
  if (!stale.length) return;
  const cancelledAt = new Date().toISOString();
  const reason = 'Истёк срок оплаты депозита';
  await supabase.from('reservations').update({
    status: 'cancelled', cancelled_at: cancelledAt, cancellation_reason: reason,
  }).in('id', stale.map(r => r.id));
  for (const r of stale) { r.status = 'cancelled'; r.cancelledAt = cancelledAt; r.cancellationReason = reason; }
}

// ─── time utils ──────────────────────────────────────────────────────────────
export function timeToMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
export function minToTime(m) {
  return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

function generateId() { return 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

// ─── row <-> reservation mapping ─────────────────────────────────────────────
function rowToRes(r) {
  return {
    id: r.id,
    tableId: r.table_id,
    guestId: r.guest_id,
    source: r.source,
    status: r.status,
    date: r.date,
    timeFrom: r.time_from,
    timeTo: r.time_to,
    guestsCount: r.guests_count,
    depositPrice: r.deposit_price,
    depositStatus: r.deposit_status,
    depositTransactionId: r.deposit_transaction_id || null,
    createdByAdminId: r.created_by_admin_id || null,
    cancellationReason: r.cancellation_reason || null,
    guestName: r.guest_name || '',
    guestPhone: r.guest_phone || '',
    note: r.note || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    cancelledAt: r.cancelled_at || null,
  };
}

// ─── table config (jsonb blob in app_config) ─────────────────────────────────
async function loadTableConfig() {
  const { data, error } = await supabase
    .from('app_config').select('value').eq('key', TABLE_CONFIG_KEY).maybeSingle();
  if (error || !data) return {};
  return data.value || {};
}
async function saveTableConfig(cfg) {
  await supabase.from('app_config').upsert({ key: TABLE_CONFIG_KEY, value: cfg });
}

export async function getTablesMerged() {
  const cfg = await loadTableConfig();
  const removed = new Set(cfg.__removed || []);
  const base = TABLES
    .filter(t => !removed.has(t.id))
    .map(t => {
      const ov = cfg[t.id] || {};
      return {
        ...t,
        depositPrice: ov.depositPrice ?? t.depositPrice ?? 0,
        ...(t.type === 'round' ? { cx: ov.cx ?? t.cx, cy: ov.cy ?? t.cy } : {}),
        ...(t.type === 'bar' ? { bx: ov.bx ?? t.bx, by: ov.by ?? t.by } : {}),
        ...(t.type !== 'round' && t.type !== 'bar' ? { x: ov.x ?? t.x, y: ov.y ?? t.y } : {}),
        seats: t.seats.map((s, i) => ({ ...s, active: ov.seats?.[i]?.active ?? s.active })),
      };
    });
  return [...base, ...(cfg.__custom || [])];
}

// ─── reservations ─────────────────────────────────────────────────────────────
export async function getReservations(filters = {}) {
  let q = supabase.from('reservations').select('*');
  if (filters.date)    q = q.eq('date', filters.date);
  if (filters.tableId) q = q.eq('table_id', filters.tableId);
  if (filters.status)  q = q.eq('status', filters.status);
  if (filters.source)  q = q.eq('source', filters.source);
  if (filters.guestId) q = q.eq('guest_id', filters.guestId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data || []).map(rowToRes);
  await expireStalePending(rows);
  return rows;
}

export async function getTableStatus(tableId, date, time) {
  const active = (await getReservations({ tableId, date }))
    .filter(r => r.status !== 'cancelled' && r.status !== 'no_show');
  const t = timeToMin(time);
  for (const r of active) {
    const start = timeToMin(r.timeFrom);
    const end = timeToMin(r.timeTo);
    if (t >= start && t < end) return { status: 'occupied', reservation: r };
    if (start > t && start - t <= 90) return { status: 'reserved', reservation: r };
  }
  return { status: 'vacant', reservation: null };
}

// Status for ALL tables at once — single reservations query (avoids N round-trips).
async function statusMapForDate(date, time) {
  const all = (await getReservations({ date }))
    .filter(r => r.status !== 'cancelled' && r.status !== 'no_show');
  const t = timeToMin(time);
  const map = {};
  for (const r of all) {
    if (map[r.tableId]?.status === 'occupied') continue;
    const start = timeToMin(r.timeFrom), end = timeToMin(r.timeTo);
    if (t >= start && t < end) map[r.tableId] = { status: 'occupied', reservation: r };
    else if (start > t && start - t <= 90 && !map[r.tableId]) map[r.tableId] = { status: 'reserved', reservation: r };
  }
  return map;
}

export async function getTablesWithStatus(date, time) {
  const [tables, smap] = await Promise.all([getTablesMerged(), statusMapForDate(date, time)]);
  return tables.map(tbl => {
    const s = smap[tbl.id] || { status: 'vacant', reservation: null };
    const publicRes = s.reservation ? {
      id: s.reservation.id, timeFrom: s.reservation.timeFrom,
      timeTo: s.reservation.timeTo, guestsCount: s.reservation.guestsCount,
    } : null;
    return { ...tbl, activeSeatsCount: activeSeats(tbl), status: s.status, reservation: publicRes };
  });
}

export async function getTablesWithStatusAdmin(date, time) {
  const [tables, smap] = await Promise.all([getTablesMerged(), statusMapForDate(date, time)]);
  return tables.map(tbl => {
    const s = smap[tbl.id] || { status: 'vacant', reservation: null };
    return { ...tbl, activeSeatsCount: activeSeats(tbl), status: s.status, reservation: s.reservation };
  });
}

export async function createReservation(p) {
  const {
    tableId, date, timeFrom, timeTo, guestsCount,
    guestName, guestPhone = '', note = '',
    source = 'web', guestId = null, createdByAdminId = null,
  } = p;

  if (!guestName?.trim()) throw new Error('Имя гостя обязательно');
  if (!tableId) throw new Error('Стол не выбран');
  if (!date) throw new Error('Дата обязательна');
  if (!timeFrom || !timeTo) throw new Error('Время обязательно');

  const check = await getTableStatus(tableId, date, timeFrom);
  if (check.status !== 'vacant') throw new Error(`Стол ${tableId} уже занят на это время`);

  const table = (await getTablesMerged()).find(t => t.id === tableId);
  const depositPrice = table?.depositPrice ?? 0;

  const now = new Date().toISOString();
  // Only the site's own payment step (InfoPanel → handlePay) can move a booking
  // out of 'pending' — phone/bot bookings have no such step, so they'd be stuck
  // forever if we put them in 'pending' too. Scope this to source==='web' only.
  const awaitingPayment = source === 'web' && depositPrice > 0;
  const row = {
    id: generateId(),
    table_id: tableId,
    guest_id: guestId,
    source,
    status: awaitingPayment ? 'pending' : 'confirmed',
    date,
    time_from: timeFrom,
    time_to: timeTo,
    guests_count: guestsCount,
    deposit_price: depositPrice,
    deposit_status: depositPrice > 0 ? 'pending' : 'not_required',
    created_by_admin_id: createdByAdminId,
    guest_name: guestName.trim(),
    guest_phone: guestPhone.trim(),
    note: note.trim(),
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from('reservations').insert(row).select().single();
  if (error) {
    // Гонка: два запроса прошли проверку getTableStatus почти одновременно
    // (двойной клик «Подтвердить», два гостя жмут в одну секунду) — второй
    // теперь ловит нарушение уникального индекса вместо создания дубля.
    if (error.code === '23505') throw new Error(`Стол ${tableId} уже занят на это время`);
    throw new Error(error.message);
  }
  return rowToRes(data);
}

export async function cancelReservation(id, reason = '') {
  const { data: existing, error: e1 } = await supabase.from('reservations').select('*').eq('id', id).single();
  if (e1 || !existing) throw new Error('Бронь не найдена');
  if (existing.status === 'cancelled') throw new Error('Бронь уже отменена');
  const r = rowToRes(existing);

  let depositStatus = r.depositStatus;
  if (r.depositStatus === 'paid_mock' && r.date && r.timeFrom) {
    const bookingTime = new Date(`${r.date}T${r.timeFrom}:00`);
    const hoursUntil = (bookingTime - new Date()) / 3600000;
    depositStatus = hoursUntil >= BOOKING_RULES.freeCancellationHours ? 'refunded' : 'partially_retained';
  }
  const { data, error } = await supabase.from('reservations').update({
    status: 'cancelled', cancelled_at: new Date().toISOString(),
    cancellation_reason: reason, deposit_status: depositStatus,
  }).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return rowToRes(data);
}

export async function updateReservationStatus(id, newStatus) {
  const { data: existing } = await supabase.from('reservations').select('status, guest_id').eq('id', id).maybeSingle();
  if (!existing) throw new Error('Бронь не найдена');
  // Гость мог отменить бронь, пока у админа на экране (сайт или бот, не
  // обновляется в реальном времени) всё ещё висит старый статус — защита от
  // случайного «Завершить»/«Подтвердить» на уже отменённой/завершённой брони
  // (например, начисления баллов за отменённый визит) (BACKLOG.md #20).
  if (existing.status === 'cancelled' || existing.status === 'completed') {
    throw new Error('Бронь уже в финальном статусе — обновите список');
  }

  const patch = { status: newStatus };
  if (newStatus === 'cancelled') patch.cancelled_at = new Date().toISOString();
  const { data, error } = await supabase.from('reservations').update(patch).eq('id', id).select().single();
  if (error) throw new Error('Бронь не найдена');

  // Баллы лояльности — за реальный визит, начисляются один раз при переходе в 'completed'.
  // Работает независимо от того, кто перевёл статус — сайт-админка или бот.
  if (newStatus === 'completed' && existing.status !== 'completed' && existing.guest_id) {
    awardVisitPoints(existing.guest_id).catch(e => console.error('[loyalty] award failed:', e.message));
  }
  return rowToRes(data);
}

export async function updateReservation(id, updates) {
  const map = {
    tableId: 'table_id', date: 'date', timeFrom: 'time_from', timeTo: 'time_to',
    guestsCount: 'guests_count', guestName: 'guest_name', guestPhone: 'guest_phone',
    note: 'note', status: 'status',
  };
  const patch = {};
  for (const [k, v] of Object.entries(updates)) if (map[k]) patch[map[k]] = v;
  const { data, error } = await supabase.from('reservations').update(patch).eq('id', id).select().single();
  if (error) throw new Error('Бронь не найдена');
  return rowToRes(data);
}

export async function payDeposit(reservationId) {
  const { data: existing, error: e1 } = await supabase.from('reservations').select('*').eq('id', reservationId).single();
  if (e1 || !existing) throw new Error('Бронь не найдена');
  const r = rowToRes(existing);
  // Guest could be sitting on the payment screen past PENDING_PAYMENT_TIMEOUT_MS —
  // the row may already have been auto-cancelled by expireStalePending() via some
  // other read in the meantime. Reject rather than silently reviving a stale hold
  // that may have since been re-booked by someone else.
  if (r.status === 'cancelled') throw new Error('Время на оплату истекло, бронь отменена — выберите стол заново');
  if (r.depositStatus === 'paid_mock') throw new Error('Депозит уже оплачен');
  if (!r.depositPrice || r.depositPrice <= 0) throw new Error('Депозит не требуется');
  const txId = 'tx_mock_' + Date.now();
  const { data, error } = await supabase.from('reservations').update({
    deposit_status: 'paid_mock', deposit_transaction_id: txId, status: 'confirmed',
  }).eq('id', reservationId).select().single();
  if (error) throw new Error(error.message);
  return rowToRes(data);
}

// ─── table config setters ─────────────────────────────────────────────────────
export async function getTableDepositPrices() {
  return (await getTablesMerged()).map(t => ({
    id: t.id, name: t.name || t.id, zone: t.zone, type: t.type, depositPrice: t.depositPrice ?? 0,
  }));
}

export async function setTableDepositPrice(tableId, price) {
  const cfg = await loadTableConfig();
  if (!cfg[tableId]) cfg[tableId] = {};
  cfg[tableId].depositPrice = Math.max(0, Number(price) || 0);
  await saveTableConfig(cfg);
}

export async function setTableSeatActive(tableId, seatIndex, active) {
  const cfg = await loadTableConfig();
  const customIdx = (cfg.__custom || []).findIndex(t => t.id === tableId);
  if (customIdx >= 0) {
    cfg.__custom[customIdx].seats[seatIndex].active = active;
    await saveTableConfig(cfg); return;
  }
  if (!cfg[tableId]) cfg[tableId] = {};
  if (!cfg[tableId].seats) {
    const src = TABLES.find(t => t.id === tableId);
    cfg[tableId].seats = src ? src.seats.map(s => ({ active: s.active })) : [];
  }
  while (cfg[tableId].seats.length <= seatIndex) cfg[tableId].seats.push({ active: true });
  cfg[tableId].seats[seatIndex] = { ...cfg[tableId].seats[seatIndex], active };
  await saveTableConfig(cfg);
}

export async function setTablePosition(tableId, posUpdates) {
  const cfg = await loadTableConfig();
  const customIdx = (cfg.__custom || []).findIndex(t => t.id === tableId);
  if (customIdx >= 0) Object.assign(cfg.__custom[customIdx], posUpdates);
  else { if (!cfg[tableId]) cfg[tableId] = {}; Object.assign(cfg[tableId], posUpdates); }
  await saveTableConfig(cfg);
}

export async function addCustomTable(tableData) {
  const cfg = await loadTableConfig();
  if (!cfg.__custom) cfg.__custom = [];
  const taken = new Set([...TABLES.map(t => t.id), ...cfg.__custom.map(t => t.id)]);
  let n = 1; while (taken.has(`X${n}`)) n++;
  const newTable = { ...tableData, id: `X${n}` };
  cfg.__custom.push(newTable);
  await saveTableConfig(cfg);
  return newTable;
}

export async function removeTable(tableId) {
  const cfg = await loadTableConfig();
  if ((cfg.__custom || []).some(t => t.id === tableId)) {
    cfg.__custom = cfg.__custom.filter(t => t.id !== tableId);
  } else {
    if (!cfg.__removed) cfg.__removed = [];
    if (!cfg.__removed.includes(tableId)) cfg.__removed.push(tableId);
  }
  await saveTableConfig(cfg);
}

export async function resetTableLayout() {
  const cfg = await loadTableConfig();
  delete cfg.__removed; delete cfg.__custom;
  for (const key of Object.keys(cfg)) {
    if (key.startsWith('__')) continue;
    delete cfg[key].cx; delete cfg[key].cy;
    delete cfg[key].x; delete cfg[key].y;
    delete cfg[key].bx; delete cfg[key].by;
  }
  await saveTableConfig(cfg);
}
