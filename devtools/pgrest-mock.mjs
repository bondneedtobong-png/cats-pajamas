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
};
const PK = { otps: 'phone', app_config: 'key', web_login_tokens: 'token' };

const DEFAULTS = {
  users: r => ({ name: '', phone: '', telegram_id: null, telegram_username: null, role: 'guest', level_override: null, bot_blocked: false, created_at: now(), ...r }),
  reservations: r => ({ staff_message_id: null, staff_reminder_count: 0, attendance_prompt_sent_at: null, cancelled_at: null, cancellation_reason: null, note: '', guest_phone: '', created_at: now(), updated_at: now(), ...r }),
  table_occupancy: r => ({ source: 'walk_in', reservation_id: null, occupied_since: now(), freed_at: null, ...r }),
  app_config: r => ({ value: {}, updated_at: now(), ...r }),
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

export function startPgrestMock(db, port = 54321) {
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

    if (req.method === 'POST') {
      const items = (Array.isArray(payload) ? payload : [payload]).map(r => (DEFAULTS[table] || (x => x))(r));
      const isUpsert = prefer.includes('resolution=merge-duplicates');
      const pk = PK[table] || 'id';
      const inserted = [];
      for (const item of items) {
        if (isUpsert) {
          const existing = rows.find(r => String(r[pk]) === String(item[pk]));
          if (existing) { Object.assign(existing, item, { updated_at: now() }); inserted.push(existing); continue; }
        }
        const viol = checkUnique(table, rows, item);
        if (viol) return err(res, 409, '23505', `duplicate key value violates unique constraint "${viol}"`);
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
        if (viol) return err(res, 409, '23505', `duplicate key value violates unique constraint "${viol}"`);
        Object.assign(r, payload, 'updated_at' in r ? { updated_at: now() } : {});
      }
      if (!wantRep) { res.writeHead(204); return res.end(); }
      return respond(res, targets, { single });
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
