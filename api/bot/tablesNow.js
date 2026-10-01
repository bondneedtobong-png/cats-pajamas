import { Composer, InlineKeyboard } from 'grammy';
import { isTelegramStaff } from '../_lib/auth.js';
import {
  getTablesWithStatusAdmin, setTableOccupied, freeTableOccupancy,
  updateReservationStatus,
} from '../_lib/booking.js';
import { barNow, minToTime } from '../../src/booking/barTime.js';
import { escapeMd } from './helpers.js';

export const tablesNowComposer = new Composer();

export async function tablesNowContent() {
  const tables = (await getTablesWithStatusAdmin()).filter(t => t.type !== 'bar');
  const kb = new InlineKeyboard();
  const lines = [];
  for (const t of tables) {
    const label = `${t.zoneShort || ''} ${t.num ?? t.id}`.trim();
    const name = `*${label}*`;
    if (t.status === 'occupied' && t.occupancy?.source === 'walk_in') {
      const extra = t.reservation ? ` · есть бронь к ${t.reservation.timeFrom}!` : '';
      lines.push(`🔴 ${name} — занят (walk-in)${extra}`);
      kb.text(`🟢 Освободить ${label}`, `tblfree:${t.id}`).row();
    } else if (t.status === 'occupied') {
      const r = t.reservation;
      lines.push(`🔴 ${name} — занят (бронь${r ? ', ' + escapeMd(r.guestName) : ''})`);
      if (r) kb.text(`🏁 Гости ушли ${label}`, `tbldone:${r.id}`).text(`❌ Не пришли ${label}`, `tblno:${r.id}`).row();
    } else if (t.status === 'reserved') {
      const r = t.reservation;
      if (r.status === 'pending') {
        lines.push(`🟡 ${name} — заявка к ${r.timeFrom} · подтвердите в теме «Брони»`);
      } else {
        lines.push(`🟡 ${name} — бронь к ${r.timeFrom} (${escapeMd(r.guestName)})`);
        kb.text(`🙋 Гости пришли ${label}`, `tblseat:${r.id}`).row();
      }
    } else {
      lines.push(`🟢 ${name} — свободен`);
      kb.text(`🔴 Занять ${label} (walk-in)`, `tblocc:${t.id}`).row();
    }
  }
  kb.text('🔄 Обновить', 'tbl').row().text('‹ Админ-панель', 'adminmenu');
  const text = `🍸 *Столы сейчас* · обновлено ${minToTime(barNow().minutes)}\n\n${lines.join('\n')}`;
  return { text, kb };
}

async function renderTablesNow(ctx, { edit }) {
  const { text, kb } = await tablesNowContent();
  const opts = { reply_markup: kb, parse_mode: 'Markdown' };
  if (edit) {
    return ctx.editMessageText(text, opts).catch(() => {});
  }
  return ctx.reply(text, { ...opts, message_thread_id: ctx.message?.message_thread_id });
}

tablesNowComposer.callbackQuery('tbl', async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  await ctx.answerCallbackQuery();
  return renderTablesNow(ctx, { edit: true });
});

tablesNowComposer.command('tables', async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return;
  return renderTablesNow(ctx, { edit: false });
});

tablesNowComposer.callbackQuery(/^tblocc:(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  try {
    const occupied = await setTableOccupied(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: occupied ? 'Отмечен занятым (walk-in)' : 'Стол уже занят' });
  } catch (e) {
    await ctx.answerCallbackQuery({ text: e.message, show_alert: true });
  }
  return renderTablesNow(ctx, { edit: true });
});

tablesNowComposer.callbackQuery(/^tblfree:(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  try {
    const freed = await freeTableOccupancy(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: freed ? 'Стол свободен' : 'Стол уже свободен' });
  } catch (e) {
    await ctx.answerCallbackQuery({ text: e.message, show_alert: true });
  }
  return renderTablesNow(ctx, { edit: true });
});

tablesNowComposer.callbackQuery(/^tblseat:(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  try {
    await updateReservationStatus(ctx.match[1], 'seated', { fromStatus: 'confirmed' });
    await ctx.answerCallbackQuery({ text: 'Гости за столом 🎷' });
  } catch (e) {
    await ctx.answerCallbackQuery({ text: e.message, show_alert: true });
  }
  return renderTablesNow(ctx, { edit: true });
});

tablesNowComposer.callbackQuery(/^tbldone:(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  try {
    await updateReservationStatus(ctx.match[1], 'completed', { fromStatus: 'seated' });
    await ctx.answerCallbackQuery({ text: 'Визит завершён — стол свободен' });
  } catch (e) {
    await ctx.answerCallbackQuery({ text: e.message, show_alert: true });
  }
  return renderTablesNow(ctx, { edit: true });
});

tablesNowComposer.callbackQuery(/^tblno:(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  try {
    await updateReservationStatus(ctx.match[1], 'no_show', { fromStatus: 'seated' });
    await ctx.answerCallbackQuery({ text: 'Отмечено: гости не пришли. Стол свободен, баллов нет' });
  } catch (e) {
    await ctx.answerCallbackQuery({ text: e.message, show_alert: true });
  }
  return renderTablesNow(ctx, { edit: true });
});
