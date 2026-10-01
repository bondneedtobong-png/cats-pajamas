import { Composer, InlineKeyboard } from 'grammy';
import { ensureTelegramUser, isTelegramStaff, setUserPhone, completeLoginToken } from '../_lib/auth.js';
import {
  getReservations, getTablesMerged, cancelReservation, tableGuestLabel,
  createBookingInquiry, updateBookingInquiryStaffMessageId,
} from '../_lib/booking.js';
import { reservationInstant } from '../../src/booking/barTime.js';
import { getGuestLevel } from '../_lib/loyalty.js';
import { rsvpToEvent } from '../_lib/eventRsvps.js';
import { notifyStaff } from '../_lib/staffNotify.js';
import {
  SITE_URL, BAR_PHONE, fmtDate, escapeMd, pluralBookings,
  resetSession, isSubscribed, proceedWebLogin, subGate,
  guestMenu, persistentKeyboard,
} from './helpers.js';

export const guestComposer = new Composer();

const FB_CANCEL_KB = new InlineKeyboard().text('‹ Отмена', 'fbcancel');

async function freeBookingStart(ctx, { edit } = {}) {
  if (!(await isSubscribed(ctx.api, ctx.from.id))) {
    const g = subGate();
    return edit ? ctx.editMessageText(g.text, { reply_markup: g.kb }) : ctx.reply(g.text, { reply_markup: g.kb });
  }
  resetSession(ctx);
  ctx.session.step = 'fb_when';
  const text = '📝 *Заявка на бронь*\n\nШаг 1 из 3. Напишите дату и время визита — например: «12 июля, 21:00».';
  const opts = { reply_markup: FB_CANCEL_KB, parse_mode: 'Markdown' };
  return edit ? ctx.editMessageText(text, opts) : ctx.reply(text, opts);
}

const greet = async (ctx) => {
  const payload = (ctx.match || '').trim();
  if (payload.startsWith('login_')) ctx.session.loginToken = payload.slice('login_'.length);

  const subbed = await isSubscribed(ctx.api, ctx.from.id);
  if (!subbed) {
    const g = subGate();
    return ctx.reply(g.text, { reply_markup: g.kb });
  }
  if (await proceedWebLogin(ctx)) return;
  await ensureTelegramUser(ctx.from);

  if (payload === 'bigparty') return freeBookingStart(ctx, { edit: false });

  await ctx.replyWithPhoto(`${SITE_URL}/uploads/team/bar-evening.jpg`, {
    caption: `🎷 Привет, ${ctx.from.first_name}! Это Cat's Pajamas — джаз-бар, где столик ждёт, уровень растёт с каждым визитом, а бармены уже разогревают шейкеры.\n\nЖми ниже — и вы внутри, без лишних меню.`,
    reply_markup: new InlineKeyboard().webApp("🐾 Открыть Cat's Pajamas", `${SITE_URL}/app`),
  });
  if (isTelegramStaff(ctx.from.id)) {
    await ctx.reply('Вам доступна админ-панель: команда /admin или кнопка «🛠 Админ-панель» в меню.');
  }
  return ctx.reply('Быстрый доступ теперь всегда под рукой снизу экрана.', {
    reply_markup: persistentKeyboard(),
  });
};

guestComposer.command('start', greet);

guestComposer.hears('🏠 Меню', async (ctx) => {
  resetSession(ctx);
  return ctx.reply('Выберите действие:', { reply_markup: guestMenu(isTelegramStaff(ctx.from.id)) });
});

guestComposer.callbackQuery('sub', async (ctx) => {
  await ctx.answerCallbackQuery();
  const subbed = await isSubscribed(ctx.api, ctx.from.id);
  if (!subbed) {
    const g = subGate();
    return ctx.editMessageText('Пока не вижу подписку 😿 Подпишитесь и нажмите ещё раз.', { reply_markup: g.kb });
  }
  if (await proceedWebLogin(ctx)) return;
  await ensureTelegramUser(ctx.from);
  await ctx.editMessageText('Готово! Доступ открыт 🎉\nВыберите действие:', {
    reply_markup: guestMenu(isTelegramStaff(ctx.from.id)),
  });
  return ctx.reply('🎷 Быстрый доступ теперь всегда под рукой снизу экрана.', {
    reply_markup: persistentKeyboard(),
  });
});

guestComposer.callbackQuery('menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  return ctx.editMessageText('Выберите действие:', { reply_markup: guestMenu(isTelegramStaff(ctx.from.id)) });
});

guestComposer.callbackQuery('bk', async (ctx) => {
  await ctx.answerCallbackQuery();
  return freeBookingStart(ctx, { edit: true });
});

guestComposer.command('booking_steps', (ctx) => freeBookingStart(ctx, { edit: false }));

guestComposer.callbackQuery('fbcancel', async (ctx) => {
  await ctx.answerCallbackQuery({ text: 'Отменено' });
  resetSession(ctx);
  return ctx.editMessageText('Выберите действие:', { reply_markup: guestMenu(isTelegramStaff(ctx.from.id)) }).catch(() => {});
});

// Отправка текстовой заявки: сохраняем в таблицу booking_inquiries + шлём в Telegram персонала
guestComposer.callbackQuery('fbsend', async (ctx) => {
  const d = ctx.session.draft;
  if (!d?.fbWhen || !d?.fbGuests) {
    await ctx.answerCallbackQuery();
    resetSession(ctx);
    return ctx.editMessageText('Заявка утеряна, начните заново.', {
      reply_markup: new InlineKeyboard().text('📝 Забронировать текстом', 'bk').row().text('🏠 Меню', 'menu'),
    });
  }
  await ctx.answerCallbackQuery({ text: 'Отправляю...' });
  const user = await ensureTelegramUser(ctx.from);
  const uname = ctx.from.username ? ' · @' + escapeMd(ctx.from.username) : '';
  const phone = user.phone ? ` · +${user.phone}` : '';
  const staffText = '🙋 *Заявка на бронь текстом*\n\n'
    + `📅 ${escapeMd(d.fbWhen)}\n`
    + `👥 Гостей: ${d.fbGuests}\n`
    + (d.fbMsg ? `💬 ${escapeMd(d.fbMsg)}\n` : '')
    + `👤 ${escapeMd(user.name || ctx.from.first_name || 'Гость')}${uname}${phone}\n\n`
    + 'Ответьте гостю в Telegram и, если договорились, создайте бронь в админке.';

  // Сохраняем лид в БД (booking_inquiries), чтобы ни одна заявка не потерялась
  const inquiry = await createBookingInquiry({
    guestId: user?.id || null,
    telegramId: ctx.from.id,
    guestName: user?.name || ctx.from.first_name || 'Гость',
    guestPhone: user?.phone || '',
    whenText: d.fbWhen,
    guestsCount: d.fbGuests,
    message: d.fbMsg || '',
  }).catch((e) => {
    console.error('[guest] inquiry save error:', e.message);
    return null;
  });

  resetSession(ctx);
  const sentId = await notifyStaff(staffText, { threadId: process.env.TELEGRAM_STAFF_BOOKINGS_THREAD_ID });
  if (sentId && inquiry?.id) {
    updateBookingInquiryStaffMessageId(inquiry.id, sentId).catch(() => {});
  }

  if (!sentId) {
    return ctx.editMessageText(
      `Не получилось передать заявку 😿 Позвоните нам, пожалуйста: ${BAR_PHONE}`,
      { reply_markup: new InlineKeyboard().text('🏠 Меню', 'menu') },
    );
  }
  return ctx.editMessageText(
    '📨 *Заявка у барменов!*\n\nОни посмотрят, что можно придумать, и ответят вам здесь, в Telegram 🎷',
    { reply_markup: new InlineKeyboard().text('🏠 Меню', 'menu'), parse_mode: 'Markdown' },
  );
});

// Мои брони
guestComposer.callbackQuery('my', async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await ensureTelegramUser(ctx.from);
  const [all, tables] = await Promise.all([getReservations({ guestId: user.id }), getTablesMerged()]);
  const active = all
    .filter(r => ['pending', 'confirmed', 'seated'].includes(r.status))
    .filter(r => r.status === 'seated' || reservationInstant(r.date, r.timeFrom).getTime() > Date.now() - 60 * 60000)
    .sort((a, b) => (a.date + a.timeFrom < b.date + b.timeFrom ? -1 : 1));
  if (!active.length) {
    const kb = new InlineKeyboard().text('📅 Забронировать', 'bk').row().text('🏠 Меню', 'menu');
    return ctx.editMessageText('У вас нет активных броней.', { reply_markup: kb });
  }
  const ST = { pending: '⏳ ждёт подтверждения бармена', confirmed: '✅ подтверждена', seated: '🎷 вы за столом' };
  const kb = new InlineKeyboard();
  const lines = active.map(r => {
    const table = tables.find(t => t.id === r.tableId);
    return `• ${fmtDate(r.date)} к ${r.timeFrom} — ${tableGuestLabel(table)}\n  ${ST[r.status]}`;
  });
  active
    .filter(r => r.status !== 'seated')
    .forEach(r => kb.text(`❌ Отменить ${fmtDate(r.date)} ${r.timeFrom}`, `myx:${r.id}`).row());
  kb.text('🏠 Меню', 'menu');
  return ctx.editMessageText(`📋 *Ваши брони:*\n\n${lines.join('\n')}`, { reply_markup: kb, parse_mode: 'Markdown' });
});

guestComposer.callbackQuery(/^myx:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  try {
    await cancelReservation(id, 'Отменено гостем через Telegram');
    await ctx.answerCallbackQuery({ text: 'Бронь отменена' });
  } catch (e) {
    await ctx.answerCallbackQuery({ text: e.message, show_alert: true });
  }
  return ctx.editMessageText('Бронь отменена.', {
    reply_markup: new InlineKeyboard().text('📋 Мои брони', 'my').text('🏠 Меню', 'menu'),
  });
});

// Номер телефона (contact)
guestComposer.on('message:contact', async (ctx) => {
  const contact = ctx.message.contact;
  if (contact.user_id !== ctx.from.id) {
    return ctx.reply('Нужен именно ваш номер — пришлите его кнопкой ниже 🙏', {
      reply_markup: { keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
    });
  }
  const user = await ensureTelegramUser(ctx.from);
  if (!user.phone) await setUserPhone(user.id, contact.phone_number);

  const loginToken = ctx.session.loginToken;
  ctx.session.loginToken = null;
  await ctx.reply('Спасибо! Номер сохранён 🎷', { reply_markup: { remove_keyboard: true } });

  if (!loginToken) {
    return ctx.reply('Выберите действие:', { reply_markup: guestMenu(isTelegramStaff(ctx.from.id)) });
  }
  try {
    await completeLoginToken(loginToken, ctx.from, contact.phone_number);
    return ctx.reply('✅ *Вход на сайте подтверждён!*\n\nВернитесь на вкладку сайта — вы уже вошли.', {
      reply_markup: new InlineKeyboard().url('🌐 Открыть сайт', SITE_URL), parse_mode: 'Markdown',
    });
  } catch (e) {
    return ctx.reply(`Не получилось завершить вход на сайте: ${e.message}. Попробуйте войти на сайте ещё раз.`);
  }
});

// Мой уровень
guestComposer.callbackQuery('loy', async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await ensureTelegramUser(ctx.from);
  const s = await getGuestLevel(user.id);
  const progress = s.next
    ? `До уровня ${s.next.num} «${s.next.label}» ${s.next.emoji} — ещё ${s.next.remaining} ${pluralBookings(s.next.remaining)}.`
    : 'Это максимальный уровень — выше только звёзды джаза 🎷';
  const kb = new InlineKeyboard().text('📅 Забронировать', 'bk').row().text('🏠 Меню', 'menu');
  return ctx.editMessageText(
    `${s.level.emoji} *Ваш уровень: ${s.level.num} из 9 — ${s.level.label}*\n\n`
    + `Подтверждённых броней: *${s.bookings}*\n${progress}\n\n`
    + 'Уровень растёт с каждой подтверждённой бронью — бронируйте стол и приходите 🎷',
    { reply_markup: kb, parse_mode: 'Markdown' },
  );
});

// RSVP на событие
guestComposer.callbackQuery(/^rsvp:(.+)$/, async (ctx) => {
  const eventId = ctx.match[1];
  try {
    const user = await ensureTelegramUser(ctx.from);
    const result = await rsvpToEvent(eventId, user.id, String(ctx.from.id));
    await ctx.answerCallbackQuery({ text: result ? 'Записал! Увидимся 🎷' : 'Вы уже записаны 🙌' });
  } catch (e) {
    await ctx.answerCallbackQuery({ text: e.message || 'Не получилось записаться', show_alert: true });
  }
});

// Шаги мастера текстовой заявки (fb_*)
guestComposer.on('message:text', async (ctx, next) => {
  const guestStep = ctx.session.step;
  if (!guestStep || !guestStep.startsWith('fb_')) return next();

  const gText = ctx.message.text.trim();
  if (gText === '/cancel') {
    resetSession(ctx);
    return ctx.reply('Отменено.', { reply_markup: guestMenu(isTelegramStaff(ctx.from.id)) });
  }
  if (guestStep === 'fb_when') {
    if (!gText || gText.length > 120) {
      return ctx.reply('Напишите дату и время текстом, например: «12 июля, 21:00».', { reply_markup: FB_CANCEL_KB });
    }
    ctx.session.draft.fbWhen = gText;
    ctx.session.step = 'fb_guests';
    return ctx.reply('Шаг 2 из 3. Сколько вас будет? Напишите число:', { reply_markup: FB_CANCEL_KB });
  }
  if (guestStep === 'fb_guests') {
    const n = parseInt(gText.replace(/\D/g, ''), 10);
    if (!Number.isFinite(n) || n < 1 || n > 200) {
      return ctx.reply('Напишите число гостей, например: 6', { reply_markup: FB_CANCEL_KB });
    }
    ctx.session.draft.fbGuests = n;
    ctx.session.step = 'fb_msg';
    return ctx.reply(
      'Шаг 3 из 3. Сообщение для барменов: какой стол хотите, повод, пожелания. Или отправьте «-», чтобы пропустить:',
      { reply_markup: FB_CANCEL_KB },
    );
  }
  if (guestStep === 'fb_msg') {
    ctx.session.draft.fbMsg = gText === '-' ? '' : gText.slice(0, 500);
    ctx.session.step = null;
    const d = ctx.session.draft;
    const kb = new InlineKeyboard()
      .text('📨 Отправить барменам', 'fbsend').row()
      .text('✏️ Начать заново', 'bk').row()
      .text('‹ Отмена', 'fbcancel');
    return ctx.reply(
      `Проверьте заявку:\n\n📅 ${d.fbWhen}\n👥 Гостей: ${d.fbGuests}${d.fbMsg ? `\n💬 ${d.fbMsg}` : ''}\n\nОтправляем барменам?`,
      { reply_markup: kb },
    );
  }
  return next();
});
