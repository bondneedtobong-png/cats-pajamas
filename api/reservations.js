import { readBody, ok, badRequest, unauthorized, forbidden, serverError, applyCors, json } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import {
  getReservations, createReservation, cancelReservation,
  updateReservationStatus, updateReservation, payDeposit, isDemoPaymentEnabled,
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
      // «Звонок» — только когда админ ЯВНО создаёт бронь за гостя из админки
      // (ManualBookingModal шлёт source='phone_manual'). Бронь из виджета —
      // всегда source='web' и от своего имени, даже если бронирует админ
      // (раньше админ с сайта получал «звонок» + автоподтверждение — баг).
      const manual = isAdmin && body.source === 'phone_manual';
      const res1 = await createReservation({
        ...body,
        guestId: manual ? (body.guestId ?? null) : user.id,
        source: manual ? 'phone_manual' : 'web',
        createdByAdminId: manual ? user.id : null,
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
        return ok(res, { reservation: await cancelReservation(id, body.reason || '', {
          guestId: user.id, staffOverride: user.role === 'admin', fromStatus: body.fromStatus,
        }) });
      }
      if (action === 'pay') {
        if (!isDemoPaymentEnabled()) return forbidden(res, 'Онлайн-оплата пока недоступна — способ внесения депозита уточните у бармена');
        return ok(res, { reservation: await payDeposit(id, { guestId: user.id }) });
      }
      // status / transfer — admin only
      if (user.role !== 'admin') return forbidden(res);
      if (action === 'status') return ok(res, { reservation: await updateReservationStatus(id, body.status, { fromStatus: body.fromStatus }) });
      if (action === 'update') {
        if (body.expected === undefined) return badRequest(res, 'Исходные данные брони обязательны. Обновите список перед переносом');
        return ok(res, { reservation: await updateReservation(id, body.updates || {}, body.expected) });
      }
      return badRequest(res, 'Неизвестное действие');
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (e.statusCode === 409) return json(res, 409, { error: e.message });
    if (e.statusCode === 403) return forbidden(res, e.message);
    if (e.statusCode === 400) return badRequest(res, e.message);
    if (/обязательн|занят|не найдена|не требуется|уже оплачен|выбран|уже прошло|уже есть|нет на плане|уже отменена|финальном статусе/.test(e.message)) return badRequest(res, e.message);
    return serverError(res, e);
  }
}
