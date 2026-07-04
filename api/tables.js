import { readBody, ok, badRequest, forbidden, serverError, applyCors } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import {
  getTablesWithStatus, getTablesWithStatusAdmin, getTablesMerged,
  setTableDepositPrice, setTableSeatsCount,
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
        case 'set_deposit':     await setTableDepositPrice(body.tableId, body.price); break;
        case 'set_seats_count': await setTableSeatsCount(body.tableId, body.count); break;
        case 'set_dates': {
          const cur = await getBookingDatesConfig();
          const patch = {};
          if ('blockToday' in body)    patch.blockToday = !!body.blockToday;
          if ('blockTomorrow' in body) patch.blockTomorrow = !!body.blockTomorrow;
          let blocked = cur.blockedDates;
          if (body.addDate)    blocked = [...blocked, body.addDate];
          if (body.removeDate) blocked = blocked.filter(d => d !== body.removeDate);
          patch.blockedDates = blocked;
          return ok(res, { dates: await setBookingDatesConfig(patch) });
        }
        default: return badRequest(res, 'Неизвестное действие');
      }
      return ok(res, { tables: await getTablesMerged() });
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (/от 1 до 30/.test(e.message)) return badRequest(res, e.message);
    return serverError(res, e);
  }
}
