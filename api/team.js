import { readBody, ok, badRequest, forbidden, serverError, applyCors } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import {
  getTeamMembers, createTeamMember, updateTeamMember, deleteTeamMember, moveTeamMember,
} from './_lib/team.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    const user = await getUser(req);

    // ─── GET: team list (public = active only; admin = everything) ────────
    if (req.method === 'GET') {
      const { admin } = req.query;
      if (admin) {
        if (!user || user.role !== 'admin') return forbidden(res);
        return ok(res, { members: await getTeamMembers({ activeOnly: false }) });
      }
      return ok(res, { members: await getTeamMembers({ activeOnly: true }) });
    }

    // ─── POST: admin CRUD ──────────────────────────────────────────────────
    if (req.method === 'POST') {
      if (!user || user.role !== 'admin') return forbidden(res);
      const body = await readBody(req);
      switch (body.action) {
        case 'create': return ok(res, { member: await createTeamMember(body.data || {}) });
        case 'update': return ok(res, { member: await updateTeamMember(body.id, body.data || {}) });
        case 'delete': await deleteTeamMember(body.id); return ok(res, {});
        case 'move':   return ok(res, { members: await moveTeamMember(body.id, body.direction) });
        default: return badRequest(res, 'Неизвестное действие');
      }
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (/обязательно|не найден/.test(e.message)) return badRequest(res, e.message);
    return serverError(res, e);
  }
}
