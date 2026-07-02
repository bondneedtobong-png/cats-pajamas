// Small helpers for Vercel serverless functions (Node, ESM).

/**
 * Apply permissive CORS (bearer-token auth, no cookies → safe with *).
 * Returns true if the request was an OPTIONS preflight and is now handled.
 */
export function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

/** Read and JSON-parse the request body (Vercel may pass it parsed or raw). */
export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  // Fallback: stream
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

export function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export function ok(res, payload = {}) { json(res, 200, payload); }
export function badRequest(res, message) { json(res, 400, { error: message }); }
export function unauthorized(res, message = 'Не авторизован') { json(res, 401, { error: message }); }
export function forbidden(res, message = 'Нет доступа') { json(res, 403, { error: message }); }
export function serverError(res, e) {
  console.error('[api] error:', e);
  json(res, 500, { error: e?.message || 'Внутренняя ошибка' });
}
