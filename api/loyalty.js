import { ok, badRequest, unauthorized, serverError, applyCors, readBody } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import { getLoyaltyStatus, getTodaySpin, spinWheel } from './_lib/loyalty.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    const user = await getUser(req);
    if (!user) return unauthorized(res);

    // ─── GET: my loyalty status + today's spin (if any) ───────────────────
    if (req.method === 'GET') {
      const [status, todaySpin] = await Promise.all([
        getLoyaltyStatus(user.id),
        getTodaySpin(user.id),
      ]);
      return ok(res, { status, todaySpin });
    }

    // ─── POST: spin the wheel of the day ───────────────────────────────────
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (body.action !== 'spin') return badRequest(res, 'Неизвестное действие');
      const result = await spinWheel(user.id);
      return ok(res, result);
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (e.message === 'ALREADY_SPUN') return badRequest(res, 'Колесо сегодня уже крутили — приходите завтра!');
    if (/не найден/.test(e.message)) return badRequest(res, e.message);
    return serverError(res, e);
  }
}
