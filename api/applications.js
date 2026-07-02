import { readBody, ok, badRequest, forbidden, serverError, applyCors } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import { getApplications, createApplication, markReviewed, deleteApplication } from './_lib/applications.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    // ─── GET: admin-only inbox ──────────────────────────────────────────────
    if (req.method === 'GET') {
      const user = await getUser(req);
      if (!user || user.role !== 'admin') return forbidden(res);
      return ok(res, { applications: await getApplications() });
    }

    // ─── POST: public submit, admin manage ──────────────────────────────────
    if (req.method === 'POST') {
      const body = await readBody(req);

      if (body.action === 'submit') {
        // Public "join us" form — no auth required.
        return ok(res, { application: await createApplication(body.data || {}) });
      }

      const user = await getUser(req);
      if (!user || user.role !== 'admin') return forbidden(res);
      if (body.action === 'mark_reviewed') return ok(res, { application: await markReviewed(body.id) });
      if (body.action === 'delete') { await deleteApplication(body.id); return ok(res, {}); }
      return badRequest(res, 'Неизвестное действие');
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (/обязателен|обязательно|не найдена/.test(e.message)) return badRequest(res, e.message);
    return serverError(res, e);
  }
}
