import { readBody, ok, badRequest, forbidden, serverError, applyCors } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import {
  getTablesWithStatus, getTablesWithStatusAdmin, getTablesMerged,
  setTableDepositPrice, setTableSeatActive, setTablePosition,
  addCustomTable, removeTable, resetTableLayout,
} from './_lib/booking.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    const user = await getUser(req);

    // ─── GET: tables (+ optional status for a date/time) ──────────────────
    if (req.method === 'GET') {
      const { date, time, admin, merged } = req.query;
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
      switch (body.action) {
        case 'set_deposit':   await setTableDepositPrice(body.tableId, body.price); break;
        case 'set_seat':      await setTableSeatActive(body.tableId, body.seatIndex, body.active); break;
        case 'set_position':  await setTablePosition(body.tableId, body.pos || {}); break;
        case 'add_table':     return ok(res, { table: await addCustomTable(body.tableData || {}) });
        case 'remove_table':  await removeTable(body.tableId); break;
        case 'reset_layout':  await resetTableLayout(); break;
        default: return badRequest(res, 'Неизвестное действие');
      }
      return ok(res, { tables: await getTablesMerged() });
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    return serverError(res, e);
  }
}
