import { Composer, InlineKeyboard } from 'grammy';
import { isTelegramStaff } from '../_lib/auth.js';
import {
  getReservations, getReservationById, cancelReservation,
  updateReservationStatus, staffBookingText, staffConfirmKeyboard,
  tableGuestLabel, getGuestTelegramId, getTablesMerged,
} from '../_lib/booking.js';
import { getGuestContact } from '../_lib/guests.js';
import { notifyGuestTg, notifyGuestTgPhoto } from '../_lib/telegramNotify.js';
import { editStaffMessage } from '../_lib/staffNotify.js';
import { renderPlanPng } from '../_lib/planImage.js';
import { barEveningDate } from '../../src/booking/barTime.js';
import {
  fmtDate, escapeMd, staffName, STATUS_LABEL, STATUS_EMOJI,
  findTable, REJECT_REASONS, rejectReasonKeyboard, resetSession,
} from './helpers.js';

export const staffReservationsComposer = new Composer();

export async function performConfirm(id, who) {
  const r = await updateReservationStatus(id, 'confirmed', { fromStatus: 'pending' });
  const table = await findTable(r.tableId);
  if (r.staffMessageId) {
    editStaffMessage(r.staffMessageId, staffBookingText(r, table) + `\n\n✅ Подтвердил ${who}`).catch(() => {});
  }
  getGuestTelegramId(r.guestId).then(async (tgId) => {
    if (!tgId) return;
    const depLine = r.depositPrice > 0 && r.depositStatus !== 'paid_mock'
      ? `💰 Депозит ${r.depositPrice} ₽ — оплатите на сайте в «Мои брони» (засчитывается в счёт заказа).\n`
      : '';
    const caption = `✅ *Бронь подтверждена!*\n\nЖдём вас ${fmtDate(r.date)} к ${r.timeFrom}.\n🪑 ${tableGuestLabel(table)}\n${depLine}\n`
      + 'Передумаете — отмените в «📋 Мои брони» или на сайте.';
    let sent = false;
    try {
      sent = await notifyGuestTgPhoto(tgId, await renderPlanPng(r.tableId), caption);
    } catch {}
    if (!sent) await notifyGuestTg(tgId, caption);
  }).catch(() => {});
  return r;
}

export async function performReject(id, reason, who) {
  const r = await cancelReservation(id, reason, { editStaffMessage: false });
  const table = await findTable(r.tableId);
  if (r.staffMessageId) {
    editStaffMessage(r.staffMessageId, staffBookingText(r, table) + `\n\n❌ Отклонил ${who}: ${escapeMd(reason)}`).catch(() => {});
  }
  getGuestTelegramId(r.guestId).then(tgId => tgId && notifyGuestTg(tgId,
    `😿 *Бронь не подтверждена*\n\n${fmtDate(r.date)} к ${r.timeFrom} — ${escapeMd(reason.toLowerCase())}.\n\n`
    + 'Попробуйте другое время или другой стол. И помните: барная стойка не бронируется — за ней место найдётся, просто приходите 🎷',
  )).catch(() => {});
  return r;
}

export async function answerAlreadyHandled(ctx, id, e) {
  if (!/уже|финальном|не найдена/.test(e.message || '')) {
    return ctx.answerCallbackQuery({ text: e.message || 'Ошибка', show_alert: true });
  }
  const r = await getReservationById(id).catch(() => null);
  const label = r ? STATUS_LABEL[r.status] || r.status : null;
  return ctx.answerCallbackQuery({
    text: label ? `Заявка уже обработана: ${label}` : e.message,
    show_alert: true,
  });
}

// ─── Текущие брони в админке (/admin → «📋 Текущие брони») ─────────────────
async function admListContent() {
  const today = barEveningDate();
  const [all, tables] = await Promise.all([getReservations({}), getTablesMerged()]);
  const upcoming = all
    .filter(r => ['pending', 'confirmed', 'seated'].includes(r.status))
    .filter(r => r.date >= today)
    .sort((a, b) => (a.date + a.timeFrom < b.date + b.timeFrom ? -1 : 1))
    .slice(0, 25);
  const kb = new InlineKeyboard();
  for (const r of upcoming) {
    const t = tables.find(x => x.id === r.tableId);
    const label = t ? `${t.zoneShort || ''} ${t.num ?? t.id}`.trim() : r.tableId;
    kb.text(
      `${STATUS_EMOJI[r.status] || ''} ${fmtDate(r.date)} ${r.timeFrom} · ${label} · ${r.guestName || 'Гость'}`,
      `admv:${r.id}`,
    ).row();
  }
  kb.text('🔄 Обновить', 'adm').row().text('‹ Админ-панель', 'adminmenu');
  const text = upcoming.length
    ? '📋 *Текущие брони*\n\nНажмите на бронь — откроется карточка с деталями и действиями.'
    : '📋 *Текущие брони*\n\nАктивных броней нет.';
  return { text, kb };
}

async function admDetailContent(id) {
  const r = await getReservationById(id).catch(() => null);
  if (!r) {
    return { text: 'Бронь не найдена — возможно, уже удалена.', kb: new InlineKeyboard().text('‹ К списку', 'adm') };
  }
  const table = await findTable(r.tableId);
  const contact = r.guestId ? await getGuestContact(r.guestId).catch(() => null) : null;
  const src = r.source === 'telegram_bot' ? 'Telegram-бот' : r.source === 'web' ? 'сайт' : 'звонок / вручную';
  const phone = r.guestPhone || contact?.phone || '';
  const lines = [
    `${STATUS_EMOJI[r.status] || ''} *Бронь — ${STATUS_LABEL[r.status] || r.status}*`,
    '',
    `🪑 ${tableGuestLabel(table)}`,
    `📅 ${fmtDate(r.date)} · приход к ${r.timeFrom}`,
    `👤 ${escapeMd(r.guestName || 'Гость')} · ${r.guestsCount} чел.`,
  ];
  if (phone) lines.push(`📞 +${phone}`);
  if (contact?.telegramUsername) lines.push(`✈️ @${escapeMd(contact.telegramUsername)}`);
  if (r.note) lines.push(`💬 ${escapeMd(r.note)}`);
  lines.push(`🌐 Источник: ${src}`);
  if (r.cancellationReason) lines.push(`❕ Причина отмены: ${escapeMd(r.cancellationReason)}`);
  const kb = new InlineKeyboard();
  if (r.status === 'pending')   kb.text('✅ Подтвердить', `admok:${id}`).text('❌ Отклонить', `admno:${id}`).row();
  if (r.status === 'confirmed') kb.text('🙋 Гости пришли', `admseat:${id}`).text('❌ Отменить', `admno:${id}`).row();
  if (r.status === 'seated')    kb.text('🏁 Гости ушли', `admdone:${id}`).text('🚫 Не пришли', `admnoshow:${id}`).row();
  kb.text('‹ К списку', 'adm').text('🏠 Меню', 'adminmenu');
  return { text: lines.join('\n'), kb };
}

staffReservationsComposer.callbackQuery('adm', async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  await ctx.answerCallbackQuery();
  const { text, kb } = await admListContent();
  return ctx.editMessageText(text, { reply_markup: kb, parse_mode: 'Markdown' }).catch(() => {});
});

staffReservationsComposer.callbackQuery(/^admv:(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  await ctx.answerCallbackQuery();
  const { text, kb } = await admDetailContent(ctx.match[1]);
  return ctx.editMessageText(text, { reply_markup: kb, parse_mode: 'Markdown' }).catch(() => {});
});

async function admAction(ctx, id, action, okText) {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  try {
    await action();
    await ctx.answerCallbackQuery({ text: okText });
  } catch (e) {
    await answerAlreadyHandled(ctx, id, e);
  }
  const { text, kb } = await admDetailContent(id);
  return ctx.editMessageText(text, { reply_markup: kb, parse_mode: 'Markdown' }).catch(() => {});
}

staffReservationsComposer.callbackQuery(/^admok:(.+)$/, (ctx) => admAction(ctx, ctx.match[1],
  () => performConfirm(ctx.match[1], staffName(ctx.from)),
  'Подтверждено — гость получил уведомление'));

staffReservationsComposer.callbackQuery(/^admno:(.+)$/, (ctx) => admAction(ctx, ctx.match[1],
  () => performReject(ctx.match[1], 'Отменена персоналом', staffName(ctx.from)),
  'Отменено — гость получил уведомление'));

staffReservationsComposer.callbackQuery(/^admseat:(.+)$/, (ctx) => admAction(ctx, ctx.match[1],
  () => updateReservationStatus(ctx.match[1], 'seated', { fromStatus: 'confirmed' }),
  'Гости за столом 🎷'));

staffReservationsComposer.callbackQuery(/^admdone:(.+)$/, (ctx) => admAction(ctx, ctx.match[1],
  () => updateReservationStatus(ctx.match[1], 'completed', { fromStatus: 'seated' }),
  'Визит завершён — стол свободен'));

staffReservationsComposer.callbackQuery(/^admnoshow:(.+)$/, (ctx) => admAction(ctx, ctx.match[1],
  () => updateReservationStatus(ctx.match[1], 'no_show', { fromStatus: 'seated' }),
  'Отмечено: гости не пришли'));

// ─── Кнопки заявок в стафф-теме «Брони» ─────────────────────────────────────
staffReservationsComposer.callbackQuery(/^stok:(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  try {
    await performConfirm(ctx.match[1], staffName(ctx.from));
    return ctx.answerCallbackQuery({ text: 'Подтверждено — гость получил уведомление' });
  } catch (e) {
    return answerAlreadyHandled(ctx, ctx.match[1], e);
  }
});

staffReservationsComposer.callbackQuery(/^stno:(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  const id = ctx.match[1];
  const r = await getReservationById(id).catch(() => null);
  if (!r || r.status !== 'pending') {
    return answerAlreadyHandled(ctx, id, new Error('Заявка уже обработана'));
  }
  await ctx.answerCallbackQuery({ text: 'Выберите причину' });
  return ctx.editMessageReplyMarkup({ reply_markup: rejectReasonKeyboard(id) }).catch(() => {});
});

staffReservationsComposer.callbackQuery(/^stnor:([^:]+):(nomest|closed)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  try {
    await performReject(ctx.match[1], REJECT_REASONS[ctx.match[2]], staffName(ctx.from));
    return ctx.answerCallbackQuery({ text: 'Отклонено — гость получил уведомление' });
  } catch (e) {
    return answerAlreadyHandled(ctx, ctx.match[1], e);
  }
});

staffReservationsComposer.callbackQuery(/^stnor:([^:]+):custom$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  const id = ctx.match[1];
  await ctx.answerCallbackQuery();
  ctx.session.step = 'st_reject_reason';
  ctx.session.draft = { rejectId: id };
  const prompt = await ctx.reply(
    '✍️ Напишите причину отклонения ОТВЕТОМ (Reply) на это сообщение — гость получит её в личку.',
    {
      message_thread_id: ctx.callbackQuery.message?.message_thread_id,
      reply_markup: new InlineKeyboard().text('‹ Передумал(а)', `stnocancel:${id}`),
    },
  );
  ctx.session.draft.promptId = prompt.message_id;
});

staffReservationsComposer.callbackQuery(/^stnoback:(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  const id = ctx.match[1];
  const r = await getReservationById(id).catch(() => null);
  if (!r || r.status !== 'pending') return answerAlreadyHandled(ctx, id, new Error('Заявка уже обработана'));
  await ctx.answerCallbackQuery();
  return ctx.editMessageReplyMarkup({ reply_markup: staffConfirmKeyboard(id) }).catch(() => {});
});

staffReservationsComposer.callbackQuery(/^stnocancel:(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  resetSession(ctx);
  await ctx.answerCallbackQuery({ text: 'Отменено' });
  return ctx.deleteMessage().catch(() => {});
});

// Кнопки явки из старых сообщений (для обратной совместимости)
staffReservationsComposer.callbackQuery(/^att(yes|no):(.+)$/, async (ctx) => {
  if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
  const attended = ctx.match[1] === 'yes';
  try {
    await updateReservationStatus(ctx.match[2], attended ? 'completed' : 'no_show');
    await ctx.answerCallbackQuery({ text: attended ? 'Отмечено: гость был' : 'Отмечено как неявка' });
  } catch (e) {
    await ctx.answerCallbackQuery({ text: e.message, show_alert: true });
    return;
  }
  return ctx.editMessageText(
    ctx.callbackQuery.message.text + (attended ? '\n\n✅ Гость был.' : '\n\n❌ Гость не пришёл.'),
  );
});

// Ответ бармена (Reply) с причиной отклонения
staffReservationsComposer.on('message:text', async (ctx, next) => {
  if (ctx.session.step === 'st_reject_reason'
      && ctx.message.reply_to_message?.message_id === ctx.session.draft?.promptId) {
    if (!isTelegramStaff(ctx.from.id)) return;
    const { rejectId } = ctx.session.draft;
    resetSession(ctx);
    try {
      await performReject(rejectId, ctx.message.text.trim().slice(0, 200), staffName(ctx.from));
      return ctx.reply('❌ Заявка отклонена, гость получил уведомление.',
        { message_thread_id: ctx.message.message_thread_id });
    } catch (e) {
      return ctx.reply(`Не получилось отклонить: ${e.message}`,
        { message_thread_id: ctx.message.message_thread_id });
    }
  }
  return next();
});
