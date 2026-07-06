import { ok, badRequest, unauthorized, forbidden, serverError, applyCors, readBody } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import { isTelegramAdmin } from './_lib/auth.js';
import { listGuests, setGuestLevel, getGuestHistory, setUserRole } from './_lib/guests.js';

// Админский ресурс «Гости»: список зарегистрированных, история броней гостя,
// ручная правка уровня. Только для role='admin' — публичных action нет.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    const user = await getUser(req);
    if (!user) return unauthorized(res);
    if (user.role !== 'admin') return forbidden(res);

    // Управлять ролями может только супер-админ (владелец из .env), не любой admin.
    const canManageRoles = isTelegramAdmin(user.telegramId);

    if (req.method === 'GET') {
      if (req.query.history) {
        return ok(res, { reservations: await getGuestHistory(req.query.history) });
      }
      return ok(res, { guests: await listGuests(), canManageRoles });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      switch (body.action) {
        case 'set_level':
          if (!body.userId) return badRequest(res, 'userId обязателен');
          return ok(res, await setGuestLevel(body.userId, body.level ?? null));
        case 'set_role':
          if (!canManageRoles) return forbidden(res);
          if (!body.userId || !body.role) return badRequest(res, 'userId и role обязательны');
          return ok(res, await setUserRole(user.id, body.userId, body.role));
        default:
          return badRequest(res, 'Неизвестное действие');
      }
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (/не найден|Уровень должен|роль|Владельц|Свою роль/i.test(e.message)) return badRequest(res, e.message);
    return serverError(res, e);
  }
}
