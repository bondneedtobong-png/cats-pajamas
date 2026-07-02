import { readBody, ok, badRequest, forbidden, serverError, applyCors } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import {
  getCocktails, createCocktail, updateCocktail, deleteCocktail, moveCocktail,
} from './_lib/cocktails.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    const user = await getUser(req);

    // ─── GET: menu list (public = active only; admin = everything) ────────
    if (req.method === 'GET') {
      const { admin } = req.query;
      if (admin) {
        if (!user || user.role !== 'admin') return forbidden(res);
        return ok(res, { cocktails: await getCocktails({ activeOnly: false }) });
      }
      return ok(res, { cocktails: await getCocktails({ activeOnly: true }) });
    }

    // ─── POST: admin CRUD ──────────────────────────────────────────────────
    if (req.method === 'POST') {
      if (!user || user.role !== 'admin') return forbidden(res);
      const body = await readBody(req);
      switch (body.action) {
        case 'create': return ok(res, { cocktail: await createCocktail(body.data || {}) });
        case 'update': return ok(res, { cocktail: await updateCocktail(body.id, body.data || {}) });
        case 'delete': await deleteCocktail(body.id); return ok(res, {});
        case 'move':   return ok(res, { cocktails: await moveCocktail(body.id, body.direction) });
        default: return badRequest(res, 'Неизвестное действие');
      }
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (/обязательно|не найден/.test(e.message)) return badRequest(res, e.message);
    return serverError(res, e);
  }
}
