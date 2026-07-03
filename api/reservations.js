import { readBody, ok, badRequest, unauthorized, forbidden, serverError, applyCors } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import {
  getReservations, createReservation, cancelReservation,
  updateReservationStatus, updateReservation, payDeposit,
} from './_lib/booking.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    const user = await getUser(req);

    // ─── GET: list reservations ───────────────────────────────────────────
    if (req.method === 'GET') {
      const { date, tableId, status, source, mine } = req.query;
      if (mine) {
        if (!user) return unauthorized(res);
        return ok(res, { reservations: await getReservations({ guestId: user.id }) });
      }
      // full list (admin dashboard) — admin only
      if (!user || user.role !== 'admin') return forbidden(res);
      const filters = {};
      if (date) filters.date = date;
      if (tableId) filters.tableId = tableId;
      if (status) filters.status = status;
      if (source) filters.source = source;
      return ok(res, { reservations: await getReservations(filters) });
    }

    // ─── POST: create reservation ─────────────────────────────────────────
    if (req.method === 'POST') {
      if (!user) return unauthorized(res);
      const body = await readBody(req);
      const isAdmin = user.role === 'admin';
      const res1 = await createReservation({
        ...body,
        // guests book under their own id; admin may book on behalf (manual)
        guestId: isAdmin ? (body.guestId ?? null) : user.id,
        source: isAdmin ? (body.source || 'phone_manual') : 'web',
        createdByAdminId: isAdmin ? user.id : null,
      });
      return ok(res, { reservation: res1 });
    }

    // ─── PATCH: mutate a reservation ──────────────────────────────────────
    if (req.method === 'PATCH') {
      if (!user) return unauthorized(res);
      const body = await readBody(req);
      const { id, action } = body;
      if (!id) return badRequest(res, 'id обязателен');

      if (action === 'cancel') {
        // guest may cancel only own; admin any
        if (user.role !== 'admin') {
          const own = (await getReservations({ guestId: user.id })).some(r => r.id === id);
          if (!own) return forbidden(res);
        }
        return ok(res, { reservation: await cancelReservation(id, body.reason || '') });
      }
      // status / transfer — admin only
      if (user.role !== 'admin') return forbidden(res);
      if (action === 'status') return ok(res, { reservation: await updateReservationStatus(id, body.status) });
      if (action === 'update') return ok(res, { reservation: await updateReservation(id, body.updates || {}) });
      if (action === 'pay')    return ok(res, { reservation: await payDeposit(id) });
      return badRequest(res, 'Неизвестное действие');
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (/обязательн|занят|не найдена|не требуется|уже оплачен|выбран|уже прошло|уже есть|нет на плане|уже отменена|финальном статусе/.test(e.message)) return badRequest(res, e.message);
    return serverError(res, e);
  }
}
