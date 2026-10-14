import { readBody, ok, badRequest, forbidden, serverError, applyCors, json } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import {
  getTablesWithStatus, getTablesWithStatusAdmin, getTablesMerged,
  setTableDepositPrice, setTableSeatsCount, setTableConfig,
  getBookingDatesConfig, setBookingDatesConfig,
} from './_lib/booking.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    const user = await getUser(req);

    // ─── GET: tables (+ optional status for a date/time) ──────────────────
    if (req.method === 'GET') {
      const { date, time, admin, merged, dates } = req.query;
      // Публичный конфиг дат — виджет прячет закрытые владельцем даты
      if (dates) return ok(res, { dates: await getBookingDatesConfig() });
      if (merged || admin) {
        if (!user || user.role !== 'admin') return forbidden(res);
        if (merged) return ok(res, { tables: await getTablesMerged() });
        return ok(res, { tables: await getTablesWithStatusAdmin(date, time) });
      }
      // public floor plan — no guest data leaked
      return ok(res, { tables: await getTablesWithStatus(date, time) });
    }

    // ─── POST: admin table-config mutations ───────────────────────────────
    if (req.method === 'POST') {
      if (!user || user.role !== 'admin') return forbidden(res);
      const body = await readBody(req);
      // План статичен (v2): позиции столов не редактируются — только депозит,
      // число мест и календарь дат (см. AdminPage, вкладка СТОЛЫ).
      switch (body.action) {
        case 'set_config':
          if (!body.expected) return json(res, 409, { error: 'Обновите страницу перед сохранением настроек.' });
          await setTableConfig(body.tableId, body.patch || {}, body.expected); break;
        case 'set_deposit':     await setTableDepositPrice(body.tableId, body.price); break;
        case 'set_seats_count': await setTableSeatsCount(body.tableId, body.count); break;
        case 'set_dates': {
          const patch = {};
          if ('blockToday' in body) patch.blockToday = !!body.blockToday;
          if ('blockTomorrow' in body) patch.blockTomorrow = !!body.blockTomorrow;
          if (body.addDate) patch.addDate = body.addDate;
          if (body.removeDate) patch.removeDate = body.removeDate;
          return ok(res, { dates: await setBookingDatesConfig(patch, body.expected) });
        }
        default: return badRequest(res, 'Неизвестное действие');
      }
      return ok(res, { tables: await getTablesMerged() });
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (e.status === 409) return json(res, 409, { error: e.message });
    if (/от 1 до 30/.test(e.message)) return badRequest(res, e.message);
    return serverError(res, e);
  }
}
