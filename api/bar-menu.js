import { readBody, ok, badRequest, forbidden, serverError, applyCors } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import { getBarMenu, setBarMenu } from './_lib/barMenu.js';

// Барная карта: GET — публично (карта из БД с фолбэком на статику),
// POST — только админ (сохранение всей карты одним блобом).
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    if (req.method === 'GET') {
      return ok(res, await getBarMenu());
    }

    if (req.method === 'POST') {
      const user = await getUser(req);
      if (!user || user.role !== 'admin') return forbidden(res);
      const body = await readBody(req);
      if (body.action === 'save') {
        return ok(res, await setBarMenu(body.data || {}));
      }
      return badRequest(res, 'Неизвестное действие');
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (/пустой|обязательно/.test(e.message)) return badRequest(res, e.message);
    return serverError(res, e);
  }
}
