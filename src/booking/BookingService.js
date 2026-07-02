import { apiFetch } from '../api.js';

// Pure time helpers — used synchronously by the UI, no network.
function timeToMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function minToTime(m) {
  return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/**
 * Client-side booking API wrapper. All persistence is server-side (Supabase),
 * so web + Telegram bot + admin all read/write the same shared data.
 * Every method returns a Promise.
 */
const BookingService = {
  // ─── tables ──────────────────────────────────────────────────────────────
  async getTablesWithStatus(date, time) {
    const d = await apiFetch(`/api/tables?date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}`, { auth: false });
    return d.tables;
  },
  async getTablesWithStatusAdmin(date, time) {
    const d = await apiFetch(`/api/tables?admin=1&date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}`);
    return d.tables;
  },
  async getTablesMerged() {
    const d = await apiFetch('/api/tables?merged=1');
    return d.tables;
  },

  // ─── reservations ────────────────────────────────────────────────────────
  /** Current guest's own reservations. */
  async getMyReservations() {
    const d = await apiFetch('/api/reservations?mine=1');
    return d.reservations;
  },
  /** Admin: all reservations with optional filters {date,tableId,status,source}. */
  async getReservations(filters = {}) {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null && v !== ''))
    ).toString();
    const d = await apiFetch('/api/reservations' + (q ? `?${q}` : ''));
    return d.reservations;
  },
  async createReservation(p) {
    const d = await apiFetch('/api/reservations', { method: 'POST', body: p });
    return d.reservation;
  },
  async cancelReservation(id, reason = '') {
    const d = await apiFetch('/api/reservations', { method: 'PATCH', body: { id, action: 'cancel', reason } });
    return d.reservation;
  },
  async updateReservationStatus(id, status) {
    const d = await apiFetch('/api/reservations', { method: 'PATCH', body: { id, action: 'status', status } });
    return d.reservation;
  },
  async updateReservation(id, updates) {
    const d = await apiFetch('/api/reservations', { method: 'PATCH', body: { id, action: 'update', updates } });
    return d.reservation;
  },
  async payDeposit(id) {
    const d = await apiFetch('/api/reservations', { method: 'PATCH', body: { id, action: 'pay' } });
    return d.reservation;
  },

  // ─── table config (admin) ─────────────────────────────────────────────────
  async setTableDepositPrice(tableId, price) {
    return apiFetch('/api/tables', { method: 'POST', body: { action: 'set_deposit', tableId, price } });
  },
  async setTableSeatActive(tableId, seatIndex, active) {
    return apiFetch('/api/tables', { method: 'POST', body: { action: 'set_seat', tableId, seatIndex, active } });
  },
  async setTablePosition(tableId, pos) {
    return apiFetch('/api/tables', { method: 'POST', body: { action: 'set_position', tableId, pos } });
  },
  async addCustomTable(tableData) {
    const d = await apiFetch('/api/tables', { method: 'POST', body: { action: 'add_table', tableData } });
    return d.table;
  },
  async removeTable(tableId) {
    return apiFetch('/api/tables', { method: 'POST', body: { action: 'remove_table', tableId } });
  },
  async resetTableLayout() {
    return apiFetch('/api/tables', { method: 'POST', body: { action: 'reset_layout' } });
  },

  // utils
  minToTime,
  timeToMin,
};

export default BookingService;
