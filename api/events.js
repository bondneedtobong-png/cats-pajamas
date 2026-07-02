import { readBody, ok, badRequest, forbidden, serverError, applyCors } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import { getEvents, createEvent, updateEvent, deleteEvent } from './_lib/events.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    const user = await getUser(req);

    // ─── GET: events list (public = upcoming only; admin = everything) ────
    if (req.method === 'GET') {
      const { admin } = req.query;
      if (admin) {
        if (!user || user.role !== 'admin') return forbidden(res);
        return ok(res, { events: await getEvents({ upcomingOnly: false }) });
      }
      return ok(res, { events: await getEvents({ upcomingOnly: true }) });
    }

    // ─── POST: admin CRUD ──────────────────────────────────────────────────
    if (req.method === 'POST') {
      if (!user || user.role !== 'admin') return forbidden(res);
      const body = await readBody(req);
      switch (body.action) {
        case 'create': return ok(res, { event: await createEvent(body.data || {}) });
        case 'update': return ok(res, { event: await updateEvent(body.id, body.data || {}) });
        case 'delete': await deleteEvent(body.id); return ok(res, {});
        default: return badRequest(res, 'Неизвестное действие');
      }
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (/обязательн|не найдено/.test(e.message)) return badRequest(res, e.message);
    return serverError(res, e);
  }
}
