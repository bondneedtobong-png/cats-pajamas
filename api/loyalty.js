import { ok, badRequest, unauthorized, serverError, applyCors } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import { getGuestLevel } from './_lib/loyalty.js';

// Уровень текущего гостя (вкладка «Уровень» в ЛК). Баллы/колесо/каталог наград
// выведены из продукта 2026-07-04 — остался только вычисляемый уровень,
// поэтому и эндпоинт read-only. Правка уровня админом — в api/guests.js.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    const user = await getUser(req);
    if (!user) return unauthorized(res);

    if (req.method === 'GET') {
      return ok(res, { status: await getGuestLevel(user.id) });
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (/не найден/i.test(e.message)) return badRequest(res, e.message);
    return serverError(res, e);
  }
}
