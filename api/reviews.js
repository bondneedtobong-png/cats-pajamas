import { readBody, ok, badRequest, forbidden, serverError, applyCors } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import { getReviews, createReview, updateReview, deleteReview } from './_lib/reviews.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    const user = await getUser(req);

    // ─── GET: reviews (public = active+4★ only; admin = everything) ───────
    if (req.method === 'GET') {
      const { admin } = req.query;
      if (admin) {
        if (!user || user.role !== 'admin') return forbidden(res);
        return ok(res, { reviews: await getReviews({ publicOnly: false }) });
      }
      return ok(res, { reviews: await getReviews({ publicOnly: true }) });
    }

    // ─── POST: admin CRUD ──────────────────────────────────────────────────
    if (req.method === 'POST') {
      if (!user || user.role !== 'admin') return forbidden(res);
      const body = await readBody(req);
      switch (body.action) {
        case 'create': return ok(res, { review: await createReview(body.data || {}) });
        case 'update': return ok(res, { review: await updateReview(body.id, body.data || {}) });
        case 'delete': await deleteReview(body.id); return ok(res, {});
        default: return badRequest(res, 'Неизвестное действие');
      }
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (/обязательн|не найден/.test(e.message)) return badRequest(res, e.message);
    return serverError(res, e);
  }
}
