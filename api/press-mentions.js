import { readBody, ok, badRequest, forbidden, serverError, applyCors } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import {
  getPressMentions,
  createPressMention,
  updatePressMention,
  deletePressMention,
} from './_lib/pressMentions.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    const user = await getUser(req);

    // ─── GET: упоминания (публично = только active; админу = все) ──────────
    if (req.method === 'GET') {
      const { admin } = req.query;
      if (admin) {
        if (!user || user.role !== 'admin') return forbidden(res);
        return ok(res, { mentions: await getPressMentions({ publicOnly: false }) });
      }
      return ok(res, { mentions: await getPressMentions({ publicOnly: true }) });
    }

    // ─── POST: админский CRUD ──────────────────────────────────────────────
    if (req.method === 'POST') {
      if (!user || user.role !== 'admin') return forbidden(res);
      const body = await readBody(req);
      switch (body.action) {
        case 'create': return ok(res, { mention: await createPressMention(body.data || {}) });
        case 'update': return ok(res, { mention: await updatePressMention(body.id, body.data || {}) });
        case 'delete': await deletePressMention(body.id); return ok(res, {});
        default: return badRequest(res, 'Неизвестное действие');
      }
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (/обязательн|не найден|Ссылка/.test(e.message)) return badRequest(res, e.message);
    return serverError(res, e);
  }
}
