import crypto from 'node:crypto';
import { supabase } from './supabase.js';

// Lightweight signed session token: `${userId}.${hmac(userId)}`.
// Prevents a client from spoofing an arbitrary userId without the secret.
// Not a full JWT — enough for this app's trust model.

const SECRET = process.env.SESSION_SECRET || 'dev-insecure-secret';

function sign(userId) {
  return crypto.createHmac('sha256', SECRET).update(userId).digest('hex');
}

export function issueToken(userId) {
  return `${userId}.${sign(userId)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const userId = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = sign(userId);
  // constant-time compare
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return userId;
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
    role: r.role || 'guest',
    createdAt: r.created_at,
  };
}
