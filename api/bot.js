import { Bot, InlineKeyboard, Keyboard, session } from 'grammy';
import { readBody } from './_lib/http.js';
import { ensureTelegramUser, isTelegramAdmin, completeLoginToken, setUserPhone } from './_lib/auth.js';
import {
  getTablesWithStatusAdmin, getTablesMerged, getReservations,
  createReservation, cancelReservation, updateReservationStatus,
  timeToMin, minToTime,
} from './_lib/booking.js';
import {
  getLoyaltyStatus, getTodaySpin, spinWheel, getUnredeemedPrizes, markPrizeRedeemed,
} from './_lib/loyalty.js';
import { getEvents, createEvent } from './_lib/events.js';
import { sendBroadcast } from './_lib/broadcast.js';
import { supabaseSessionStorage } from './_lib/botSession.js';
import { createReview, checkReviewCooldown } from './_lib/reviews.js';

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const CHANNEL = process.env.TELEGRAM_CHANNEL;           // @catspajajam
const SECRET  = process.env.TELEGRAM_WEBHOOK_SECRET;
const CHANNEL_URL = CHANNEL ? `https://t.me/${CHANNEL.replace(/^@/, '')}` : '';
const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://cats-pajamas-club.vercel.app';
const TIME_SLOTS = ['17:00','18:00','18:30','19:00','19:30','20:00','20:30','21:00','21:30','22:00','23:00'];
const DURATION_MIN = 120;

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d) {
  const today = new Date(); today.setHours(0,0,0,0);
  const dt = new Date(d + 'T00:00:00');
  const diff = Math.round((dt - today) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  const [, m, day] = d.split('-');
  return `${day}.${m}`;
}
function nextDays(n) {
  const out = [];
  const base = new Date(); base.setHours(0,0,0,0);
  for (let i = 0; i < n; i++) {
    const dt = new Date(base.getTime() + i * 86400000);
    out.push(dt.toISOString().split('T')[0]);
  }
  return out;
}
function fmtEventDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
function eventBroadcastText(ev, isReminder) {
  const head = isReminder ? '🎷 *Напоминаем о событии!*' : "🎷 *Новое событие в Cat's Pajamas Club!*";
  const time = ev.time ? ` в ${ev.time}` : '';
  const desc = ev.description ? `\n${ev.description}` : '';
  return `${head}\n\n*${ev.title}*\n📅 ${fmtEventDate(ev.date)}${time}${desc}\n\nЗабронировать стол — /start`;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function resetSession(ctx) { ctx.session.step = null; ctx.session.draft = {}; }

// ─── вход на сайте через бота (deep-link /start login_<token>) ──────────────
// Возвращает true, если это был шаг логин-флоу (и ответ уже отправлен) —
// вызывающий код (greet/sub) в этом случае не должен показывать обычное меню.
async function proceedWebLogin(ctx) {
  const loginToken = ctx.session.loginToken;
  if (!loginToken) return false;
  const user = await ensureTelegramUser(ctx.from);

  if (user.phone) {
    ctx.session.loginToken = null;
    try {
      await completeLoginToken(loginToken, ctx.from, user.phone);
    } catch (e) {
      await ctx.reply(`Не получилось завершить вход на сайте: ${e.message}`);
      return true;
    }
    await ctx.reply('✅ *Вход подтверждён!*\n\nВернитесь на вкладку сайта — вы уже вошли.', {
      reply_markup: new InlineKeyboard().url('🌐 Открыть сайт', SITE_URL), parse_mode: 'Markdown',
    });
    return true;
  }

  await ctx.reply(
    'Чтобы завершить вход на сайте, поделитесь номером телефона — так администратор сможет связаться с вами по брони.',
    { reply_markup: { keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } },
  );
  return true;
}

async function isSubscribed(api, userId) {
  if (!CHANNEL) return true; // not configured → don't block
  try {
    const m = await api.getChatMember(CHANNEL, userId);
    if (['creator', 'administrator', 'member'].includes(m.status)) return true;
    if (m.status === 'restricted') return m.is_member !== false;
    return false;
  } catch {
    return false; // bot not admin of channel / user never started → treat as not subscribed
  }
}

// Гостевое меню — запасной путь на случай, если Mini App не открылся (старое
// устройство, десктопный клиент без поддержки webApp и т.п.). Админ-функции
// сюда больше не попадают — у них отдельный /admin, см. adminMenu() ниже.
function guestMenu() {
  return new InlineKeyboard()
    .webApp("🪑 Открыть Cat's Pajamas", `${SITE_URL}/app`).row()
    .text('📝 Забронировать текстом', 'bk').row()
    .text('📋 Мои брони', 'my').row()
    .text('🎖 Мой уровень', 'loy').row();
}

function adminMenu() {
  return new InlineKeyboard()
    .text('🛠 Заявки', 'adm').row()
    .text('📢 Событие', 'ev').row()
    .text('🎁 Призы', 'prizes').row()
    .text('🏠 Обычное меню', 'menu');
}

// Persistent reply-keyboard — в отличие от inline-меню, не «уезжает» вверх
// истории чата и не пропадает между сообщениями. Ровно 2 кнопки: сам Mini
// App и текстовый fallback — раньше один и тот же список действий дублировался
// в трёх местах (сюда, в /start и в «🏠 Меню»), теперь только тут и в fallback.
function persistentKeyboard() {
  return new Keyboard()
    .webApp('🪑 Открыть', `${SITE_URL}/app`)
    .text('🏠 Меню')
    .resized()
    .persistent();
}

function subGate() {
  const kb = new InlineKeyboard()
    .url('Открыть канал', CHANNEL_URL).row()
    .text('Я подписался ✅', 'sub').row();
  return {
    text: `Чтобы бронировать через бота, подпишитесь на наш канал ${CHANNEL}.\n\nЭто способ сказать спасибо постоянным гостям 🎷`,
    kb,
  };
}

// ─── bot (module-scoped, initialised once per cold start) ──────────────────────
let _bot = null;
let _inited = false;

export function buildBot() {
  const bot = new Bot(TOKEN);

  // Персистентная сессия (переживает холодный старт serverless-функции) —
  // мастер «Добавить событие» и флоу «вход с сайта» (loginToken), хранится в app_config.
  bot.use(session({ initial: () => ({ step: null, draft: {}, loginToken: null }), storage: supabaseSessionStorage() }));

  // ─── «Полка воспоминаний»: отзывы из Telegram-обсуждения ────────────────────
  // ВАЖНО: зарегистрировано через bot.chatType(...) и ДО bot.on('message:text', ...)
  // (мастер событий, ниже). grammY не продолжает цепочку middleware дальше того
  // обработчика, чей фильтр совпал первым — если бы этот код стоял как обычный
  // bot.on('message', ...) после мастера событий, любое групповое текстовое
  // сообщение всё равно сначала перехватывалось бы бот.on('message:text', ...)
  // (его фильтр не смотрит на тип чата) и тихо съедалось там (!isTelegramAdmin
  // → return, без вызова next()). Скоуп по chatType создаёт отдельную ветку
  // композера для group/supergroup, которая не пересекается с приватными чатами.
  bot.chatType(['group', 'supergroup']).on('message', async (ctx) => {
    if (String(ctx.chat.id) !== process.env.TELEGRAM_REVIEWS_CHAT_ID) return; // не наша группа
    if (process.env.TELEGRAM_REVIEWS_THREAD_ID &&
        String(ctx.message.message_thread_id) !== process.env.TELEGRAM_REVIEWS_THREAD_ID) return; // не та тема
    if (ctx.message.new_chat_members || ctx.message.left_chat_member || ctx.message.pinned_message) return; // служебное
    if (!ctx.message.text || ctx.message.text.trim().length < 10) return; // пусто/слишком коротко
    if (ctx.from.is_bot) return;

    const user = await ensureTelegramUser(ctx.from);
    const telegramId = String(ctx.from.id);

    const cooldown = await checkReviewCooldown(telegramId);
    if (cooldown.blocked) {
      await ctx.deleteMessage().catch(() => {}); // требует права «Удаление сообщений» у бота в группе
      const dateStr = cooldown.nextAllowedAt.toLocaleDateString('ru-RU');
      await ctx.api.sendMessage(ctx.from.id,
        `Спасибо за тёплые слова! 🎷 Следующее воспоминание можно оставить после ${dateStr} — раз в месяц, чтобы полка росла у всех гостей поровну.`,
      ).catch(() => {}); // ЛС не доставится, если гость никогда не писал боту напрямую — тихо игнорируем
      return;
    }

    await createReview({
      author: user.name || ctx.from.first_name,
      text: ctx.message.text.trim(),
      rating: 5, // у сообщений в Telegram нет оценки звёздами — дефолт
      source: 'telegram_group',
      telegram_id: telegramId,
      telegram_message_id: ctx.message.message_id,
    }).catch(() => {}); // best-effort — повторная доставка вебхука не должна ронять обработку
  });

  const greet = async (ctx) => {
    // Deep-link с сайта: t.me/<bot>?start=login_<token> — /start приходит с payload в ctx.match.
    const payload = (ctx.match || '').trim();
    if (payload.startsWith('login_')) ctx.session.loginToken = payload.slice('login_'.length);

    const subbed = await isSubscribed(ctx.api, ctx.from.id);
    if (!subbed) {
      const g = subGate();
      return ctx.reply(g.text, { reply_markup: g.kb });
    }
    if (await proceedWebLogin(ctx)) return;
    await ensureTelegramUser(ctx.from);
    await ctx.replyWithPhoto(`${SITE_URL}/uploads/team/bar-evening.jpg`, {
      caption: `🎷 Привет, ${ctx.from.first_name}! Это Cat's Pajamas — джаз-бар, где столик ждёт, колесо дня крутится, а бариста уже разогревают шейкеры.\n\nЖми ниже — и вы внутри, без лишних меню.`,
      reply_markup: new InlineKeyboard().webApp("🐾 Открыть Cat's Pajamas", `${SITE_URL}/app`),
    });
    if (isTelegramAdmin(ctx.from.id)) {
      await ctx.reply('Вы админ — панель заявок и событий доступна через /admin.');
    }
    return ctx.reply('Быстрый доступ теперь всегда под рукой снизу экрана.', {
      reply_markup: persistentKeyboard(),
    });
  };

  bot.command('start', greet);

  bot.command('admin', async (ctx) => {
    if (!isTelegramAdmin(ctx.from.id)) return;
    resetSession(ctx);
    return ctx.reply('🛠 *Админ-панель*', { reply_markup: adminMenu(), parse_mode: 'Markdown' });
  });

  // Персистентная клавиатура «🏠 Меню» — открывает привычное inline-меню новым
  // сообщением (в отличие от callbackQuery('menu'), тут нечего редактировать).
  // Сбрасывает session.step — если админ был на середине мастера событий и
  // запаниковал/передумал, тап по «🏠 Меню» должен выходить из мастера, а не
  // застревать (следующее его сообщение иначе ушло бы обратно в мастер).
  bot.hears('🏠 Меню', async (ctx) => {
    resetSession(ctx);
    return ctx.reply('Выберите действие:', { reply_markup: guestMenu() });
  });

  // recheck subscription
  bot.callbackQuery('sub', async (ctx) => {
    await ctx.answerCallbackQuery();
    const subbed = await isSubscribed(ctx.api, ctx.from.id);
    if (!subbed) {
      const g = subGate();
      return ctx.editMessageText('Пока не вижу подписку 😿 Подпишитесь и нажмите ещё раз.', { reply_markup: g.kb });
    }
    if (await proceedWebLogin(ctx)) return;
    await ensureTelegramUser(ctx.from);
    await ctx.editMessageText('Готово! Доступ открыт 🎉\nВыберите действие:', {
      reply_markup: guestMenu(),
    });
    return ctx.reply('🎷 Быстрый доступ теперь всегда под рукой снизу экрана.', {
      reply_markup: persistentKeyboard(),
    });
  });

  // main menu
  bot.callbackQuery('menu', async (ctx) => {
    await ctx.answerCallbackQuery();
    return ctx.editMessageText('Выберите действие:', { reply_markup: guestMenu() });
  });

  // «Меню» внутри админ-экранов (adm/ev/prizes) ведёт обратно в adminMenu,
  // а не в гостевое — иначе админ терял бы доступ к своим кнопкам в один тап.
  bot.callbackQuery('adminmenu', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isTelegramAdmin(ctx.from.id)) return;
    return ctx.editMessageText('🛠 *Админ-панель*', { reply_markup: adminMenu(), parse_mode: 'Markdown' });
  });

  // booking: choose date (запасной путь для тех, у кого не открылся Mini App —
  // единственная точка входа теперь и кнопка «Забронировать текстом», и /booking_steps)
  async function bookingStepsStart(ctx, { edit } = {}) {
    if (!(await isSubscribed(ctx.api, ctx.from.id))) {
      const g = subGate();
      return edit ? ctx.editMessageText(g.text, { reply_markup: g.kb }) : ctx.reply(g.text, { reply_markup: g.kb });
    }
    const kb = new InlineKeyboard();
    nextDays(7).forEach((d, i) => {
      kb.text(fmtDate(d), `bkd:${d}`);
      if (i % 2 === 1) kb.row();
    });
    kb.row().text('‹ Назад', 'menu');
    const text = 'На какой день бронируем?';
    return edit ? ctx.editMessageText(text, { reply_markup: kb }) : ctx.reply(text, { reply_markup: kb });
  }

  bot.callbackQuery('bk', async (ctx) => {
    await ctx.answerCallbackQuery();
    return bookingStepsStart(ctx, { edit: true });
  });

  // Telegram не разрешает дефис в именах команд (только [a-z0-9_]) —
  // /booking_steps вместо /booking-steps.
  bot.command('booking_steps', (ctx) => bookingStepsStart(ctx, { edit: false }));

  // booking: choose time
  bot.callbackQuery(/^bkd:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const date = ctx.match[1];
    const kb = new InlineKeyboard();
    TIME_SLOTS.forEach((t, i) => {
      kb.text(t, `bkt:${date}:${t}`);
      if (i % 3 === 2) kb.row();
    });
    kb.row().text('‹ Назад', 'bk');
    return ctx.editMessageText(`📅 ${fmtDate(date)} — выберите время:`, { reply_markup: kb });
  });

  // booking: choose table (only vacant)
  bot.callbackQuery(/^bkt:([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, date, time] = ctx.match;
    const tables = await getTablesWithStatusAdmin(date, time);
    const vacant = tables.filter(t => t.status === 'vacant');
    if (!vacant.length) {
      const kb = new InlineKeyboard().text('‹ Другое время', `bkd:${date}`);
      return ctx.editMessageText(`На ${fmtDate(date)} ${time} свободных столов нет 😔`, { reply_markup: kb });
    }
    const kb = new InlineKeyboard();
    vacant.forEach((t, i) => {
      const cap = t.activeSeatsCount;
      kb.text(`${t.id} (${cap}м · ${t.zone})`, `bkc:${date}:${time}:${t.id}`);
      if (i % 2 === 1) kb.row();
    });
    kb.row().text('‹ Назад', `bkd:${date}`);
    return ctx.editMessageText(`🪑 ${fmtDate(date)} ${time} — выберите стол:`, { reply_markup: kb });
  });

  // booking: confirm screen
  bot.callbackQuery(/^bkc:([^:]+):([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, date, time, tableId] = ctx.match;
    const timeTo = minToTime(timeToMin(time) + DURATION_MIN);
    const kb = new InlineKeyboard()
      .text('✅ Подтвердить', `bkok:${date}:${time}:${tableId}`).row()
      .text('‹ Назад', `bkt:${date}:${time}`);
    return ctx.editMessageText(
      `Проверьте бронь:\n\n🪑 Стол *${tableId}*\n📅 ${fmtDate(date)}\n🕐 ${time}–${timeTo}\n\nПодтвердить?`,
      { reply_markup: kb, parse_mode: 'Markdown' },
    );
  });

  // booking: create
  bot.callbackQuery(/^bkok:([^:]+):([^:]+):(.+)$/, async (ctx) => {
    const [, date, time, tableId] = ctx.match;
    try {
      if (!(await isSubscribed(ctx.api, ctx.from.id))) {
        await ctx.answerCallbackQuery({ text: 'Нужна подписка на канал', show_alert: true });
        const g = subGate();
        return ctx.editMessageText(g.text, { reply_markup: g.kb });
      }
      const user = await ensureTelegramUser(ctx.from);
      const table = (await getTablesMerged()).find(t => t.id === tableId);
      const cap = table ? table.seats.filter(s => s.active).length : 2;
      const timeTo = minToTime(timeToMin(time) + DURATION_MIN);
      const r = await createReservation({
        tableId, date, timeFrom: time, timeTo,
        guestsCount: Math.min(2, cap || 1),
        guestName: ctx.from.first_name || 'Гость',
        source: 'telegram_bot', guestId: user.id,
      });
      await ctx.answerCallbackQuery({ text: 'Готово!' });
      const kb = new InlineKeyboard().text('📋 Мои брони', 'my').text('🏠 Меню', 'menu');
      return ctx.editMessageText(
        `✅ *Бронь подтверждена!*\n\n🪑 Стол ${r.tableId}\n📅 ${fmtDate(date)}\n🕐 ${r.timeFrom}–${r.timeTo}\n\nЖдём вас! 🎷`,
        { reply_markup: kb, parse_mode: 'Markdown' },
      );
    } catch (e) {
      await ctx.answerCallbackQuery({ text: e.message || 'Ошибка', show_alert: true });
      const kb = new InlineKeyboard().text('‹ Выбрать заново', `bkt:${date}:${time}`);
      return ctx.editMessageText(`Не удалось забронировать: ${e.message}`, { reply_markup: kb });
    }
  });

  // my reservations
  bot.callbackQuery('my', async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await ensureTelegramUser(ctx.from);
    const all = await getReservations({ guestId: user.id });
    const active = all
      .filter(r => r.status === 'confirmed' || r.status === 'pending')
      .filter(r => new Date(`${r.date}T${r.timeFrom}:00`) > new Date())
      .sort((a, b) => (a.date + a.timeFrom < b.date + b.timeFrom ? -1 : 1));
    if (!active.length) {
      const kb = new InlineKeyboard().text('📅 Забронировать', 'bk').row().text('🏠 Меню', 'menu');
      return ctx.editMessageText('У вас нет активных броней.', { reply_markup: kb });
    }
    const kb = new InlineKeyboard();
    const lines = active.map(r => `• ${r.tableId} — ${fmtDate(r.date)} ${r.timeFrom}–${r.timeTo}`);
    active.forEach(r => kb.text(`❌ Отменить ${r.tableId} (${fmtDate(r.date)} ${r.timeFrom})`, `myx:${r.id}`).row());
    kb.text('🏠 Меню', 'menu');
    return ctx.editMessageText(`📋 *Ваши брони:*\n\n${lines.join('\n')}`, { reply_markup: kb, parse_mode: 'Markdown' });
  });

  bot.callbackQuery(/^myx:(.+)$/, async (ctx) => {
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

  // ─── вход на сайте: гость делится номером телефона ──────────────────────────
  bot.on('message:contact', async (ctx) => {
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
      return ctx.reply('Выберите действие:', { reply_markup: guestMenu() });
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

  // ─── лояльность: статус + колесо дня ────────────────────────────────────────
  bot.callbackQuery('loy', async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await ensureTelegramUser(ctx.from);
    const status = await getLoyaltyStatus(user.id);
    const spin = await getTodaySpin(user.id);
    const progress = status.next
      ? `До уровня ${status.next.label} — ещё ${status.next.min - status.points} баллов.`
      : 'Вы на максимальном уровне — выше только звёзды джаза 🎷';
    const wheelLine = spin
      ? `Колесо дня сегодня уже крутили: *${spin.prize_label}*. Новый спин — завтра.`
      : 'Колесо дня ещё не крутили сегодня — попробуйте!';
    const kb = new InlineKeyboard();
    if (!spin) kb.text('🎡 Крутить колесо дня', 'wheel').row();
    kb.text('🏠 Меню', 'menu');
    return ctx.editMessageText(
      `🎖 *Ваш статус: ${status.tier.label}*\n\nБаллы: *${status.points}*\n${progress}\n\n${wheelLine}\n\n`
      + 'Баллы начисляются, когда бармен отмечает ваш визит завершённым — просто бронируйте стол и приходите 🎷',
      { reply_markup: kb, parse_mode: 'Markdown' },
    );
  });

  bot.callbackQuery('wheel', async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await ensureTelegramUser(ctx.from);
    const already = await getTodaySpin(user.id);
    if (already) {
      return ctx.editMessageText(
        `Сегодня вы уже крутили колесо: *${already.prize_label}*.\nНовый спин будет доступен завтра 🎷`,
        { reply_markup: new InlineKeyboard().text('🎖 Мой уровень', 'loy').text('🏠 Меню', 'menu'), parse_mode: 'Markdown' },
      );
    }
    await ctx.editMessageText('🎡 Крутим колесо...');
    await sleep(500);
    await ctx.editMessageText('🎰 Ещё немного...');
    await sleep(500);
    try {
      const { prize } = await spinWheel(user.id);
      const kb = new InlineKeyboard().text('🎖 Мой уровень', 'loy').text('🏠 Меню', 'menu');
      const note = prize.redeem ? '\n\nПокажите это сообщение бармену, чтобы получить приз 🐾' : '';
      return ctx.editMessageText(`🎉 *Результат:*\n\n${prize.label}${note}\n\nНовый спин — завтра!`, { reply_markup: kb, parse_mode: 'Markdown' });
    } catch (e) {
      if (e.message === 'ALREADY_SPUN') {
        return ctx.editMessageText('Сегодня уже крутили колесо — новый спин завтра 🎷', {
          reply_markup: new InlineKeyboard().text('🏠 Меню', 'menu'),
        });
      }
      return ctx.editMessageText('Не получилось — попробуйте позже.', { reply_markup: new InlineKeyboard().text('🏠 Меню', 'menu') });
    }
  });

  // ─── admin ──────────────────────────────────────────────────────────────────
  bot.callbackQuery('adm', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isTelegramAdmin(ctx.from.id)) return ctx.editMessageText('Нет доступа.');
    const today = new Date().toISOString().split('T')[0];
    const all = await getReservations({});
    const upcoming = all
      .filter(r => r.status === 'confirmed' || r.status === 'pending')
      .filter(r => r.date >= today)
      .sort((a, b) => (a.date + a.timeFrom < b.date + b.timeFrom ? -1 : 1))
      .slice(0, 10);
    if (!upcoming.length) {
      return ctx.editMessageText('Заявок нет.', { reply_markup: new InlineKeyboard().text('🏠 Меню', 'adminmenu') });
    }
    const kb = new InlineKeyboard();
    const lines = upcoming.map(r => {
      const src = r.source === 'telegram_bot' ? 'TG' : r.source === 'web' ? 'сайт' : 'звонок';
      const st = r.status === 'pending' ? '⏳' : '✅';
      return `${st} ${r.tableId} · ${fmtDate(r.date)} ${r.timeFrom} · ${r.guestName} · ${src}`;
    });
    upcoming.forEach(r => {
      kb.text(`❌ ${r.tableId} ${r.timeFrom}`, `admno:${r.id}`);
      if (r.status === 'pending') kb.text(`✅ ${r.tableId}`, `admok:${r.id}`);
      if (r.status === 'confirmed') kb.text(`🏁 Завершить`, `admdone:${r.id}`);
      kb.row();
    });
    kb.text('🏠 Меню', 'adminmenu');
    return ctx.editMessageText(`🛠 *Ближайшие заявки:*\n\n${lines.join('\n')}`, { reply_markup: kb, parse_mode: 'Markdown' });
  });

  bot.callbackQuery(/^admok:(.+)$/, async (ctx) => {
    if (!isTelegramAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    try { await updateReservationStatus(ctx.match[1], 'confirmed'); await ctx.answerCallbackQuery({ text: 'Подтверждено' }); }
    catch (e) { await ctx.answerCallbackQuery({ text: e.message, show_alert: true }); }
    return ctx.editMessageText('Готово. Обновить список — «Заявки».', {
      reply_markup: new InlineKeyboard().text('🛠 Заявки', 'adm').text('🏠 Меню', 'adminmenu'),
    });
  });

  bot.callbackQuery(/^admdone:(.+)$/, async (ctx) => {
    if (!isTelegramAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    try { await updateReservationStatus(ctx.match[1], 'completed'); await ctx.answerCallbackQuery({ text: 'Визит завершён, баллы начислены' }); }
    catch (e) { await ctx.answerCallbackQuery({ text: e.message, show_alert: true }); }
    return ctx.editMessageText('Готово. Обновить список — «Заявки».', {
      reply_markup: new InlineKeyboard().text('🛠 Заявки', 'adm').text('🏠 Меню', 'adminmenu'),
    });
  });

  bot.callbackQuery(/^admno:(.+)$/, async (ctx) => {
    if (!isTelegramAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    try { await cancelReservation(ctx.match[1], 'Отменено администратором через Telegram'); await ctx.answerCallbackQuery({ text: 'Отменено' }); }
    catch (e) { await ctx.answerCallbackQuery({ text: e.message, show_alert: true }); }
    return ctx.editMessageText('Бронь отменена. Обновить — «Заявки».', {
      reply_markup: new InlineKeyboard().text('🛠 Заявки', 'adm').text('🏠 Меню', 'adminmenu'),
    });
  });

  // ─── admin: события (добавить + разослать подписчикам) ─────────────────────
  const CANCEL_KB = new InlineKeyboard().text('‹ Отмена', 'evcancel');
  const eventsMenuKb = () => new InlineKeyboard()
    .text('➕ Добавить и разослать', 'evadd').row()
    .text('📋 Ближайшие события', 'evlist').row()
    .text('‹ Назад', 'adminmenu');

  bot.callbackQuery('ev', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isTelegramAdmin(ctx.from.id)) return;
    resetSession(ctx);
    return ctx.editMessageText('📢 *События*\n\nВыберите действие:', { reply_markup: eventsMenuKb(), parse_mode: 'Markdown' });
  });

  bot.callbackQuery('evcancel', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Отменено' });
    if (!isTelegramAdmin(ctx.from.id)) return;
    resetSession(ctx);
    return ctx.editMessageText('📢 *События*\n\nВыберите действие:', { reply_markup: eventsMenuKb(), parse_mode: 'Markdown' });
  });

  bot.callbackQuery('evadd', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isTelegramAdmin(ctx.from.id)) return;
    ctx.session.step = 'ev_title';
    ctx.session.draft = {};
    return ctx.editMessageText('Введите название события:', { reply_markup: CANCEL_KB });
  });

  bot.callbackQuery('evlist', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isTelegramAdmin(ctx.from.id)) return;
    const events = await getEvents({ upcomingOnly: true });
    const top = events.slice(0, 5);
    if (!top.length) {
      return ctx.editMessageText('Ближайших событий нет.', { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') });
    }
    const kb = new InlineKeyboard();
    const lines = top.map(e => `• ${e.title} — ${fmtEventDate(e.date)}${e.time ? ' ' + e.time : ''}`);
    top.forEach(e => kb.text(`📢 Напомнить: ${e.title}`, `evre:${e.id}`).row());
    kb.text('‹ Назад', 'ev');
    return ctx.editMessageText(`📋 *Ближайшие события:*\n\n${lines.join('\n')}`, { reply_markup: kb, parse_mode: 'Markdown' });
  });

  bot.callbackQuery(/^evre:(.+)$/, async (ctx) => {
    if (!isTelegramAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    await ctx.answerCallbackQuery({ text: 'Рассылаю...' });
    const events = await getEvents({ upcomingOnly: true });
    const found = events.find(e => e.id === ctx.match[1]);
    if (!found) return ctx.editMessageText('Событие не найдено.', { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') });
    const { total, sent, blocked } = await sendBroadcast(ctx.api, eventBroadcastText(found, true));
    return ctx.editMessageText(
      `✅ Напоминание отправлено.\nПолучателей: ${total}, доставлено: ${sent}${blocked ? `, недоступно: ${blocked}` : ''}.`,
      { reply_markup: new InlineKeyboard().text('‹ К событиям', 'ev').text('🏠 Меню', 'adminmenu') },
    );
  });

  bot.callbackQuery('evsave', async (ctx) => {
    if (!isTelegramAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    await ctx.answerCallbackQuery({ text: 'Сохраняю...' });
    const d = ctx.session.draft;
    if (!d?.title || !d?.date) {
      resetSession(ctx);
      return ctx.editMessageText('Черновик события утерян, начните заново.', { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') });
    }
    try {
      const ev = await createEvent({ title: d.title, date: d.date, time: d.time, description: d.description });
      resetSession(ctx);
      const { total, sent, blocked } = await sendBroadcast(ctx.api, eventBroadcastText(ev, false));
      return ctx.editMessageText(
        `✅ Событие сохранено и разослано.\nПолучателей: ${total}, доставлено: ${sent}${blocked ? `, недоступно: ${blocked}` : ''}.`,
        { reply_markup: new InlineKeyboard().text('‹ К событиям', 'ev').text('🏠 Меню', 'adminmenu') },
      );
    } catch (e) {
      return ctx.editMessageText(`Не удалось сохранить: ${e.message}`, { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') });
    }
  });

  // Текстовые шаги мастера «Добавить событие» — единственный обработчик свободного
  // текста в боте, реагирует только на админа с активным session.step.
  bot.on('message:text', async (ctx) => {
    if (!isTelegramAdmin(ctx.from.id)) return;
    const step = ctx.session.step;
    if (!step) return;
    const text = ctx.message.text.trim();

    if (text === '/cancel') {
      resetSession(ctx);
      return ctx.reply('Отменено.', { reply_markup: adminMenu() });
    }

    if (step === 'ev_title') {
      if (!text) return ctx.reply('Название не может быть пустым. Введите название события:', { reply_markup: CANCEL_KB });
      ctx.session.draft.title = text;
      ctx.session.step = 'ev_date';
      return ctx.reply('Введите дату в формате ДД.ММ.ГГГГ (например 15.08.2026):', { reply_markup: CANCEL_KB });
    }

    if (step === 'ev_date') {
      const m = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : null;
      if (!iso || Number.isNaN(new Date(iso).getTime())) {
        return ctx.reply('Не получилось распознать дату. Введите в формате ДД.ММ.ГГГГ, например 15.08.2026:', { reply_markup: CANCEL_KB });
      }
      ctx.session.draft.date = iso;
      ctx.session.step = 'ev_time';
      return ctx.reply('Введите время начала, например 20:00 (или «-», если без фиксированного времени):', { reply_markup: CANCEL_KB });
    }

    if (step === 'ev_time') {
      if (text !== '-' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
        return ctx.reply('Введите время в формате ЧЧ:ММ (например 20:00) или «-»:', { reply_markup: CANCEL_KB });
      }
      ctx.session.draft.time = text === '-' ? '' : text;
      ctx.session.step = 'ev_desc';
      return ctx.reply('Коротко опишите событие (2–3 предложения) или отправьте «-», чтобы пропустить:', { reply_markup: CANCEL_KB });
    }

    if (step === 'ev_desc') {
      ctx.session.draft.description = text === '-' ? '' : text;
      ctx.session.step = null;
      const d = ctx.session.draft;
      const kb = new InlineKeyboard()
        .text('✅ Сохранить и разослать', 'evsave').row()
        .text('✏️ Начать заново', 'evadd').row()
        .text('‹ Отмена', 'evcancel');
      return ctx.reply(
        `Проверьте событие:\n\n*${d.title}*\n📅 ${fmtEventDate(d.date)}${d.time ? ' ' + d.time : ''}\n${d.description || '(без описания)'}\n\nСохранить и разослать подписчикам?`,
        { reply_markup: kb, parse_mode: 'Markdown' },
      );
    }
  });

  // ─── admin: призы колеса дня (выдать вручную на месте) ──────────────────────
  bot.callbackQuery('prizes', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isTelegramAdmin(ctx.from.id)) return;
    const list = await getUnredeemedPrizes(10);
    if (!list.length) {
      return ctx.editMessageText('Невыданных призов нет 🎉', { reply_markup: new InlineKeyboard().text('🏠 Меню', 'adminmenu') });
    }
    const kb = new InlineKeyboard();
    const lines = list.map(p => `• ${p.guestName || 'Гость'} — ${p.prize_label} (${fmtEventDate(p.spin_date)})`);
    list.forEach(p => kb.text(`✅ Выдано: ${p.guestName || 'Гость'}`, `prizeok:${p.id}`).row());
    kb.text('🏠 Меню', 'adminmenu');
    return ctx.editMessageText(`🎁 *Призы к выдаче:*\n\n${lines.join('\n')}`, { reply_markup: kb, parse_mode: 'Markdown' });
  });

  bot.callbackQuery(/^prizeok:(.+)$/, async (ctx) => {
    if (!isTelegramAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    try { await markPrizeRedeemed(ctx.match[1]); await ctx.answerCallbackQuery({ text: 'Отмечено как выдано' }); }
    catch (e) { await ctx.answerCallbackQuery({ text: e.message, show_alert: true }); }
    return ctx.editMessageText('Готово. Обновить список — «Призы».', {
      reply_markup: new InlineKeyboard().text('🎁 Призы', 'prizes').text('🏠 Меню', 'adminmenu'),
    });
  });

  bot.catch((err) => console.error('[bot] error:', err?.error || err));
  return bot;
}

async function getBot() {
  if (!_bot) _bot = buildBot();
  if (!_inited) { await _bot.init(); _inited = true; }
  return _bot;
}

// ─── Vercel handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'GET') { res.status(200).end('Cat\'s Pajamas bot webhook'); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }
  if (!TOKEN) { res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not set' }); return; }
  if (SECRET && req.headers['x-telegram-bot-api-secret-token'] !== SECRET) { res.status(401).end(); return; }
  try {
    const update = await readBody(req);
    const bot = await getBot();
    await bot.handleUpdate(update);
  } catch (e) {
    console.error('[bot] handler error:', e);
  }
  res.status(200).end(); // always ack so Telegram doesn't retry-storm
}
