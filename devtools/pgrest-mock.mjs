// Мини-PostgREST в памяти — песочница для локального прогона реального API
// (api/*.js + api/_lib/*) без прод-Supabase. Поддерживает подмножество,
// которое реально использует проект: select/insert/upsert/update/delete,
// фильтры eq/neq/in/is/gte/gt/lte/lt, order, single/maybeSingle,
// уникальные индексы (23505) и rpc redeem_loyalty_reward.
import http from 'node:http';

const now = () => new Date().toISOString();

const UNIQUE = {
  reservations: [
    { name: 'reservations_pkey', cols: ['id'] },
    {
      name: 'reservations_no_double_book_idx', cols: ['table_id', 'date'],
      where: r => ['pending', 'confirmed', 'seated'].includes(r.status),
    },
  ],
  table_occupancy: [
    { name: 'table_occupancy_pkey', cols: ['id'] },
    { name: 'table_occupancy_open_idx', cols: ['table_id'], where: r => r.freed_at == null },
  ],
  users: [
    { name: 'users_pkey', cols: ['id'] },
    { name: 'users_telegram_id_key', cols: ['telegram_id'], where: r => r.telegram_id != null },
  ],
  wheel_spins: [
    { name: 'wheel_spins_pkey', cols: ['id'] },
    { name: 'wheel_spins_guest_date_key', cols: ['guest_id', 'spin_date'] },
  ],
  event_rsvps: [
    { name: 'event_rsvps_pkey', cols: ['id'] },
    { name: 'event_rsvps_event_guest_key', cols: ['event_id', 'guest_id'] },
  ],
  reviews: [
    { name: 'reviews_pkey', cols: ['id'] },
    { name: 'reviews_tg_msg_key', cols: ['telegram_message_id'], where: r => r.telegram_message_id != null },
  ],
  otps: [{ name: 'otps_pkey', cols: ['phone'] }],
  app_config: [{ name: 'app_config_pkey', cols: ['key'] }],
  web_login_tokens: [{ name: 'web_login_tokens_pkey', cols: ['token'] }],
  loyalty_transactions: [{ name: 'lt_pkey', cols: ['id'] }],
  loyalty_rewards: [{ name: 'lr_pkey', cols: ['id'] }],
  loyalty_redemptions: [{ name: 'lrd_pkey', cols: ['id'] }, { name: 'lrd_code_key', cols: ['code'] }],
  booking_inquiries: [{ name: 'booking_inquiries_pkey', cols: ['id'] }],
};
const PK = { otps: 'phone', app_config: 'key', web_login_tokens: 'token' };

const DEFAULTS = {
  users: r => ({ name: '', phone: '', telegram_id: null, telegram_username: null, role: 'guest', level_override: null, bot_blocked: false, created_at: now(), ...r }),
  reservations: r => ({ staff_message_id: null, staff_reminder_count: 0, attendance_prompt_sent_at: null, cancelled_at: null, cancellation_reason: null, note: '', guest_phone: '', created_at: now(), updated_at: now(), ...r }),
  booking_inquiries: r => ({ guest_id: null, telegram_id: null, guest_name: '', guest_phone: '', when_text: '', guests_count: 1, message: '', status: 'new', staff_message_id: null, created_at: now(), updated_at: now(), ...r }),
  table_occupancy: r => ({ source: 'walk_in', reservation_id: null, occupied_since: now(), freed_at: null, ...r }),
  app_config: r => ({ value: {}, updated_at: now(), ...r, revision: 0 }),
  events: r => ({ time: '', description: '', image_url: '', image_urls: [], sort_order: 0, active: true, awards_points: false, attendance_prompt_sent_at: null, created_at: now(), updated_at: now(), ...r }),
};

export function createDb(seed = {}) {
  const tables = new Map();
  const t = name => { if (!tables.has(name)) tables.set(name, []); return tables.get(name); };
  for (const [k, rows] of Object.entries(seed)) t(k).push(...rows.map(r => (DEFAULTS[k] || (x => x))(r)));
  return { t, tables };
}

function parseQuery(url) {
  const filters = [];
  let order = null;
  for (const [key, raw] of url.searchParams) {
    if (['select', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    if (key === 'order') { order = raw; continue; }
    const dot = raw.indexOf('.');
    if (dot < 0) continue;
    filters.push({ col: key, op: raw.slice(0, dot), val: raw.slice(dot + 1) });
  }
  return { filters, order };
}

function matches(row, { col, op, val }) {
  const v = row[col];
  switch (op) {
    case 'eq':  return v != null && String(v) === val;
    case 'neq': return String(v) !== val;
    case 'is':  return val === 'null' ? v == null : String(v) === val;
    case 'in': {
      const list = val.replace(/^\(/, '').replace(/\)$/, '')
        .split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      return v != null && list.includes(String(v));
    }
    case 'gte': return v != null && String(v) >= val;
    case 'gt':  return v != null && String(v) > val;
    case 'lte': return v != null && String(v) <= val;
    case 'lt':  return v != null && String(v) < val;
    default: return true;
  }
}

function checkUnique(table, rows, candidate, ignoreRow = null) {
  for (const u of UNIQUE[table] || []) {
    if (u.where && !u.where(candidate)) continue;
    if (u.cols.some(c => candidate[c] == null)) continue;
    const dup = rows.find(r => r !== ignoreRow
      && (!u.where || u.where(r))
      && u.cols.every(c => String(r[c]) === String(candidate[c])));
    if (dup) return u.name;
  }
  return null;
}

function err(res, status, code, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code, message, details: message, hint: null }));
}

function respond(res, rows, { single, status = 200 }) {
  if (single) {
    if (rows.length !== 1) {
      return err(res, 406, 'PGRST116', `JSON object requested, ${rows.length} rows returned`);
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(rows[0]));
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(rows));
}

// Opt-in SQL-trigger model for bot E2E; the default lightweight mock is unchanged.
export function startPgrestMock(db, port = 54321, { reservationOccupancyTrigger = false } = {}) {
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = body ? JSON.parse(body) : null;
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/rest\/v1\/([^/]+)$/) || url.pathname.match(/^\/rest\/v1\/(rpc)\/([^/]+)$/);
    if (!m) return err(res, 404, 'PGRST100', 'not found ' + url.pathname);

    // ── RPC ──
    if (m[1] === 'rpc') {
      if (m[2] === 'redeem_loyalty_reward') {
        const p = payload;
        const users = db.t('users');
        const u = users.find(x => x.id === p.p_user_id);
        if (!u || u.loyalty_points < p.p_cost) return err(res, 400, 'P0001', 'INSUFFICIENT_POINTS');
        u.loyalty_points -= p.p_cost;
        db.t('loyalty_redemptions').push({ id: p.p_redemption_id, code: p.p_code, user_id: p.p_user_id, reward_id: p.p_reward_id, points_spent: p.p_cost, status: 'issued', created_at: now() });
        db.t('loyalty_transactions').push({ id: p.p_redemption_id + '_tx', user_id: p.p_user_id, delta: -p.p_cost, reason: p.p_reason, source_type: 'redemption', source_id: p.p_redemption_id, balance_after: u.loyalty_points, created_at: now() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(u.loyalty_points));
      }
      return err(res, 404, 'PGRST202', 'unknown rpc');
    }

    const table = m[1];
    const rows = db.t(table);
    const { filters, order } = parseQuery(url);
    const prefer = req.headers.prefer || '';
    const single = (req.headers.accept || '').includes('vnd.pgrst.object');
    const wantRep = prefer.includes('return=representation');

    if (req.method === 'GET') {
      let out = rows.filter(r => filters.every(f => matches(r, f)));
      if (order) {
        const [col, dir] = order.split('.');
        out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      return respond(res, out, { single });
    }

    // One PostgREST write is one transaction: if any row/trigger fails,
    // restore both reservation and occupancy state before sending the error.
    const transactional = reservationOccupancyTrigger && table === 'reservations'
      && ['POST', 'PATCH'].includes(req.method);
    const snapshots = transactional ? ['reservations', 'table_occupancy'].map(name => ({
      rows: db.t(name), originals: [...db.t(name)], values: db.t(name).map(r => ({ ...r })),
    })) : [];
    function syncOccupancy(oldRow, next) {
      if (!transactional) return;
      const fail = message => { throw Object.assign(new Error(message), { code: '23514' }); };
      if (oldRow) {
        if (oldRow.status === 'seated' && ['table_id', 'date', 'time_from', 'time_to'].some(k => oldRow[k] !== next[k])) {
          fail('Seated reservation cannot be relocated');
        }
        if (oldRow.status === next.status) return;
        const transitions = { pending: ['confirmed', 'cancelled'], confirmed: ['seated', 'completed', 'no_show', 'cancelled'], seated: ['completed', 'no_show', 'cancelled'] };
        if (!transitions[oldRow.status]?.includes(next.status)) fail('Invalid reservation status transition');
      }
      const occupancies = db.t('table_occupancy');
      if (next.status === 'seated') {
        const occupancy = DEFAULTS.table_occupancy({
          id: 'occ_mock_' + next.id, table_id: next.table_id,
          source: 'reservation', reservation_id: next.id,
        });
        const violation = checkUnique('table_occupancy', occupancies, occupancy);
        if (violation) throw Object.assign(new Error('duplicate key value violates unique constraint "' + violation + '"'), { code: '23505' });
        occupancies.push(occupancy);
      } else if (['completed', 'no_show', 'cancelled'].includes(next.status)) {
        for (const o of occupancies) if (o.reservation_id === next.id && o.freed_at == null) o.freed_at = now();
      }
    }
    try {
    if (req.method === 'POST') {
      const items = (Array.isArray(payload) ? payload : [payload]).map(r => (DEFAULTS[table] || (x => x))(r));
      const isUpsert = prefer.includes('resolution=merge-duplicates');
      const pk = PK[table] || 'id';
      const inserted = [];
      for (const item of items) {
        if (isUpsert) {
          const existing = rows.find(r => String(r[pk]) === String(item[pk]));
          if (existing) { if (table === 'app_config') item.revision = existing.revision + 1; syncOccupancy(existing, item); Object.assign(existing, item, { updated_at: now() }); inserted.push(existing); continue; }
        }
        const viol = checkUnique(table, rows, item);
        if (viol) throw Object.assign(new Error(`duplicate key value violates unique constraint "${viol}"`), { code: "23505" });
        syncOccupancy(null, item);
        rows.push(item);
        inserted.push(item);
      }
      if (!wantRep) { res.writeHead(201); return res.end(); }
      return respond(res, inserted, { single, status: 201 });
    }

    if (req.method === 'PATCH') {
      const targets = rows.filter(r => filters.every(f => matches(r, f)));
      for (const r of targets) {
        const next = { ...r, ...payload };
        const viol = checkUnique(table, rows, next, r);
        if (viol) throw Object.assign(new Error(`duplicate key value violates unique constraint "${viol}"`), { code: "23505" });
        syncOccupancy(r, next);
        if (table === 'app_config') payload.revision = r.revision + 1;
        Object.assign(r, payload, 'updated_at' in r ? { updated_at: now() } : {});
      }
      if (!wantRep) { res.writeHead(204); return res.end(); }
      return respond(res, targets, { single });
    }

    } catch (error) {
      for (const snapshot of snapshots) {
        for (let i = 0; i < snapshot.originals.length; i++) {
          const row = snapshot.originals[i];
          for (const key of Object.keys(row)) delete row[key];
          Object.assign(row, snapshot.values[i]);
        }
        snapshot.rows.splice(0, snapshot.rows.length, ...snapshot.originals);
      }
      return err(res, error.code === '23505' ? 409 : 400, error.code || 'P0001', error.message);
    }

    if (req.method === 'DELETE') {
      const targets = rows.filter(r => filters.every(f => matches(r, f)));
      for (const r of targets) rows.splice(rows.indexOf(r), 1);
      if (!wantRep) { res.writeHead(204); return res.end(); }
      return respond(res, targets, { single });
    }

    return err(res, 405, 'PGRST105', 'method not allowed');
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
