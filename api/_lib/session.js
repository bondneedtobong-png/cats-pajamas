import crypto from 'node:crypto';
import { supabase } from './supabase.js';

// Versioned HMAC session with finite lifetime. Legacy userId.HMAC tokens are
// deliberately rejected. Rotate SESSION_VERSION or SESSION_SECRET to revoke all
// sessions; logout clears the client only (no per-session revocation registry).
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
function sessionConfig() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || (process.env.NODE_ENV === 'production' && Buffer.byteLength(secret) < 32)) {
    throw new Error('Сессии не настроены на сервере');
  }
  const rawTtl = process.env.SESSION_TTL_SECONDS;
  const ttl = rawTtl ? Number(rawTtl) : DEFAULT_TTL_SECONDS;
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > MAX_TTL_SECONDS) {
    throw new Error('Некорректная настройка срока сессии');
  }
  return { secret, ttl, version: process.env.SESSION_VERSION || '1' };
}
/** Validate before API/bot starts accepting requests; never print key material. */
export function assertSessionConfigured() {
  sessionConfig();
}
function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}
export function issueToken(userId) {
  if (typeof userId !== 'string' || !userId) throw new Error('Нет пользователя для сессии');
  const { secret, ttl, version } = sessionConfig();
  const iat = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat, exp: iat + ttl, sv: version })).toString('base64url');
  const value = `cp1.${payload}`;
  return `${value}.${sign(value, secret)}`;
}
export function verifyToken(token) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  try {
    const { secret, version } = sessionConfig();
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'cp1' || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return null;
    const expected = Buffer.from(sign(`cp1.${parts[1]}`, secret), 'hex');
    if (!crypto.timingSafeEqual(Buffer.from(parts[2], 'hex'), expected)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sv !== version
      || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
      || payload.iat > now || payload.exp <= now || payload.exp <= payload.iat
      || payload.exp - payload.iat > MAX_TTL_SECONDS) return null;
    return payload.sub;
  } catch { return null; }
}

/** Extract the bearer token from a request and resolve the current user (or null). */
export async function getUser(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const userId = verifyToken(token);
  if (!userId) return null;
  const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();
  if (error || !data) return null;
  return rowToUser(data);
}

export function rowToUser(r) {
  return {
    id: r.id,
    name: r.name || '',
    phone: r.phone || '',
    telegramId: r.telegram_id || null,
    telegramUsername: r.telegram_username || null,
    role: r.role || 'guest',
    createdAt: r.created_at,
  };
}
