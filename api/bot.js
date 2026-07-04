import { Bot, InlineKeyboard, Keyboard, session } from 'grammy';
import { readBody } from './_lib/http.js';
import { ensureTelegramUser, isTelegramAdmin, isTelegramStaff, completeLoginToken, setUserPhone } from './_lib/auth.js';
import {
  getTablesWithStatusAdmin, getTablesMerged, getReservations, getReservationById,
  createReservation, cancelReservation, updateReservationStatus,
  setTableOccupied, freeTableOccupancy,
  staffBookingText, staffConfirmKeyboard, tableGuestLabel, getGuestTelegramId,
} from './_lib/booking.js';
import {
  barEveningDate, upcomingEveningDates, buildTimeSlots, reservationInstant,
  barNow, minToTime,
} from '../src/booking/barTime.js';
import { notifyGuestTg, notifyGuestTgPhoto } from './_lib/telegramNotify.js';
import { editStaffMessage } from './_lib/staffNotify.js';
import { renderPlanPng } from './_lib/planImage.js';
import {
  getLoyaltyStatus, getTodaySpin, spinWheel, getUnredeemedPrizes, markPrizeRedeemed,
  findRedemptionByCode, confirmRedemption,
} from './_lib/loyalty.js';
import { getEvents, createEvent } from './_lib/events.js';
import { rsvpToEvent, confirmRsvp } from './_lib/eventRsvps.js';
import { sendBroadcast } from './_lib/broadcast.js';
import { supabaseSessionStorage } from './_lib/botSession.js';
import { createReview, checkReviewCooldown } from './_lib/reviews.js';

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const CHANNEL = process.env.TELEGRAM_CHANNEL;           // @catspajajam
const SECRET  = process.env.TELEGRAM_WEBHOOK_SECRET;
const CHANNEL_URL = CHANNEL ? `https://t.me/${CHANNEL.replace(/^@/, '')}` : '';
const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://cats-pajamas.ru';

// ─── helpers ──────────────────────────────────────────────────────────────────
// Дата вечера (бар работает за полночь, зона Самары — см. barTime.js), не
// серверная календарная: «Сегодня» на серверном UTC съезжало бы на 4 часа.
function fmtDate(d) {
  const diff = Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(barEveningDate() + 'T00:00:00Z')) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  const [, m, day] = d.split('-');
  return `${day}.${m}`;
}
// Пользовательский текст внутри Markdown (имена барменов/причины) — незакрытый
// '_'/'*' валит parse у Telegram, и сообщение не уходит вовсе.
function escapeMd(s) { return String(s || '').replace(/([_*[\]`])/g, '\\$1'); }
function staffName(from) {
  return escapeMd(from.username ? '@' + from.username : from.first_name || 'бармен');
}
const STATUS_LABEL = {
  pending: 'ждёт подтверждения', confirmed: 'подтверждена', seated: 'гости за столом',
  completed: 'завершена', cancelled: 'отменена', no_show: 'гость не пришёл',
};
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
function guestMenu(isStaff = false) {
  const kb = new InlineKeyboard()
    .webApp("🪑 Открыть Cat's Pajamas", `${SITE_URL}/app`).row()
    .text('📝 Забронировать текстом', 'bk').row()
    .text('📋 Мои брони', 'my').row()
    .text('🎖 Мой уровень', 'loy').row();
  // Раздел бармена — виден только персоналу (TELEGRAM_STAFF_IDS + админы)
  if (isStaff) kb.text('🍸 Столы сейчас', 'tbl').row();
  return kb;
}

function adminMenu() {
  return new InlineKeyboard()
    .text('🍸 Столы сейчас', 'tbl').row()
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

// ─── погашение наград каталога лояльности (/start rdm_<code> и /redeem) ────
// Только для TELEGRAM_ADMIN_IDS (как явно указано в задаче) — не для
// TELEGRAM_STAFF_IDS, в отличие от подтверждения явки по броням/событиям.
// Не-админ получает молчание, а не «нет доступа» — чужой код не должен даже
// намекать постороннему, что он существует.
async function showRedemptionCard(ctx, code) {
  if (!isTelegramAdmin(ctx.from.id)) return;
  if (!code) return ctx.reply('Использование: /redeem КОД');
  try {
    const { redemption, reward, guestName } = await findRedemptionByCode(code);
    const lines = [
      '🎁 *Погашение награды*',
      '',
      `Код: \`${redemption.code}\``,
      `Награда: ${reward?.title || '—'}`,
      `Гость: ${guestName}`,
      `Списано баллов: ${redemption.pointsSpent}`,
    ];
    if (redemption.status !== 'issued') {
      lines.push('', redemption.status === 'redeemed' ? '⚠️ Уже погашено' : '⚠️ Код истёк');
      return ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
    }
    const kb = new InlineKeyboard()
      .text('✅ Погасить', `rdmok:${redemption.code}`).row()
      .text('‹ Отмена', 'adminmenu');
    return ctx.reply(lines.join('\n'), { reply_markup: kb, parse_mode: 'Markdown' });
  } catch (e) {
    return ctx.reply(`Код не найден: ${e.message}`);
  }
}

// ─── бронирование v2: подтверждение заявок барменами (HANDOFF_BOOKING_V2 §3) ─
async function findTable(tableId) {
  return (await getTablesMerged()).find(t => t.id === tableId);
}

const REJECT_REASONS = { nomest: 'Нет свободных мест', closed: 'Закрытое мероприятие' };

function rejectReasonKeyboard(id) {
  return new InlineKeyboard()
    .text('Нет свободных мест', `stnor:${id}:nomest`).row()
    .text('Закрытое мероприятие', `stnor:${id}:closed`).row()
    .text('✍️ Своя причина', `stnor:${id}:custom`).row()
    .text('‹ Отмена', `stnoback:${id}`);
}

/** Подтверждение заявки: атомарно pending→confirmed, правка стафф-сообщения
 *  («✅ Подтвердил @бармен»), уведомление гостю в ЛС. */
async function performConfirm(id, who) {
  const r = await updateReservationStatus(id, 'confirmed', { fromStatus: 'pending' });
  const table = await findTable(r.tableId);
  if (r.staffMessageId) {
    editStaffMessage(r.staffMessageId, staffBookingText(r, table) + `\n\n✅ Подтвердил ${who}`).catch(() => {});
  }
  // Гостю — подтверждение с картинкой плана, где выделен его стол;
  // при сбое рендера/фото откатываемся на текст (уведомление важнее красоты).
  getGuestTelegramId(r.guestId).then(async (tgId) => {
    if (!tgId) return;
    const caption = `✅ *Бронь подтверждена!*\n\nЖдём вас ${fmtDate(r.date)} к ${r.timeFrom}.\n🪑 ${tableGuestLabel(table)}\n\n`
      + 'Передумаете — отмените в «📋 Мои брони» или на сайте.';
    let sent = false;
    try {
      sent = await notifyGuestTgPhoto(tgId, await renderPlanPng(r.tableId), caption);
    } catch { /* рендер не удался — ниже текстовый фолбэк */ }
    if (!sent) await notifyGuestTg(tgId, caption);
  }).catch(() => {});
  return r;
}

/** Отклонение/отмена персоналом: cancel + причина, правка стафф-сообщения,
 *  гостю — извинение с альтернативами (другое время / стол / стойка). */
async function performReject(id, reason, who) {
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

// Двойное нажатие / нажатие на уже отменённую гостем бронь → честный ответ
// «уже обработана» с текущим статусом, а не повторное действие.
async function answerAlreadyHandled(ctx, id, e) {
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

// ─── «Столы сейчас» — интерфейс бармена ──────────────────────────────────────
const TYPE_SHORT = { round: 'круглый', square: 'квадратный', booth: 'диван' };

async function tablesNowContent() {
  // Барные стулья (type='bar') не показываем: стойка не бронируется и walk-in
  // по отдельным стульям не отмечается — она всегда «просто приходите».
  const tables = (await getTablesWithStatusAdmin()).filter(t => t.type !== 'bar');
  const kb = new InlineKeyboard();
  const lines = [];
  for (const t of tables) {
    const label = `№${t.num ?? t.id}`;
    const name = `*${label}* ${TYPE_SHORT[t.type] || 'стол'}`;
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
  kb.text('🔄 Обновить', 'tbl').row().text('🏠 Меню', 'menu');
  const text = `🍸 *Столы сейчас* · обновлено ${minToTime(barNow().minutes)}\n\n${lines.join('\n')}`;
  return { text, kb };
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
  bot.chatType(['group', 'supergroup']).on('message', async (ctx, next) => {
    // Не группа отзывов (например, стафф-группа «Персонал») — пропускаем дальше
    // по цепочке: там живёт ввод причины отклонения заявки (reply на промпт).
    if (String(ctx.chat.id) !== process.env.TELEGRAM_REVIEWS_CHAT_ID) return next();
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

    // Deep-link из QR/кода погашения награды (t.me/<bot>?start=rdm_<code>, кнопка
    // «Скопировать код»/QR на сайте не даёт такой ссылки напрямую — это на случай,
    // если бармен откроет код через диплинк, а не команду /redeem). Админская
    // утилита, не часть обычного онбординга гостя — не проверяем подписку.
    if (payload.startsWith('rdm_')) return showRedemptionCard(ctx, payload.slice('rdm_'.length));

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

  // Ручной ввод кода погашения — запасной путь на случай, если сканить QR не
  // хочется (тот же showRedemptionCard, что и /start rdm_<code>).
  bot.command('redeem', (ctx) => showRedemptionCard(ctx, (ctx.match || '').trim().toUpperCase()));

  bot.callbackQuery(/^rdmok:(.+)$/, async (ctx) => {
    if (!isTelegramAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    try {
      const { reward } = await confirmRedemption(ctx.match[1], ctx.from.id);
      await ctx.answerCallbackQuery({ text: 'Погашено!' });
      return ctx.editMessageText(`✅ Погашено: ${reward?.title || ctx.match[1]}`);
    } catch (e) {
      await ctx.answerCallbackQuery({ text: e.message, show_alert: true });
    }
  });

  // Персистентная клавиатура «🏠 Меню» — открывает привычное inline-меню новым
  // сообщением (в отличие от callbackQuery('menu'), тут нечего редактировать).
  // Сбрасывает session.step — если админ был на середине мастера событий и
  // запаниковал/передумал, тап по «🏠 Меню» должен выходить из мастера, а не
  // застревать (следующее его сообщение иначе ушло бы обратно в мастер).
  bot.hears('🏠 Меню', async (ctx) => {
    resetSession(ctx);
    return ctx.reply('Выберите действие:', { reply_markup: guestMenu(isTelegramStaff(ctx.from.id)) });
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
      reply_markup: guestMenu(isTelegramStaff(ctx.from.id)),
    });
    return ctx.reply('🎷 Быстрый доступ теперь всегда под рукой снизу экрана.', {
      reply_markup: persistentKeyboard(),
    });
  });

  // main menu
  bot.callbackQuery('menu', async (ctx) => {
    await ctx.answerCallbackQuery();
    return ctx.editMessageText('Выберите действие:', { reply_markup: guestMenu(isTelegramStaff(ctx.from.id)) });
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
    upcomingEveningDates(7).forEach((d, i) => {
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

  // booking: choose time (слоты от часов работы, включая ночные после полуночи)
  bot.callbackQuery(/^bkd:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const date = ctx.match[1];
    const slots = buildTimeSlots(date);
    if (!slots.length) {
      const kb = new InlineKeyboard().text('‹ Другой день', 'bk');
      return ctx.editMessageText('На этот вечер заявки уже не принимаются — выберите другой день.', { reply_markup: kb });
    }
    const kb = new InlineKeyboard();
    slots.forEach((t, i) => {
      kb.text(t, `bkt:${date}:${t}`);
      if (i % 3 === 2) kb.row();
    });
    kb.row().text('‹ Назад', 'bk');
    return ctx.editMessageText(`📅 ${fmtDate(date)} — к какому времени вас ждать?`, { reply_markup: kb });
  });

  // booking: choose table (only vacant; правило вечера уже учтено статусами).
  // Подписи столов — человеческие, без внутренних айдишников (T1/B1).
  bot.callbackQuery(/^bkt:([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, date, time] = ctx.match;
    const tables = await getTablesWithStatusAdmin(date);
    const vacant = tables.filter(t => t.status === 'vacant' && t.type !== 'bar');
    if (!vacant.length) {
      const kb = new InlineKeyboard().text('‹ Другой день', 'bk');
      return ctx.editMessageText(
        `На ${fmtDate(date)} свободных столов нет 😔\n\nНо стойка не бронируется — за ней место найдётся всегда, просто приходите 🎷`,
        { reply_markup: kb },
      );
    }
    const kb = new InlineKeyboard();
    vacant.forEach(t => kb.text(tableGuestLabel(t), `bkc:${date}:${time}:${t.id}`).row());
    kb.text('‹ Назад', `bkd:${date}`);
    return ctx.editMessageText(`🪑 ${fmtDate(date)}, к ${time} — выберите стол:`, { reply_markup: kb });
  });

  // booking: confirm screen — только время прихода, конца брони в модели нет.
  // Время в callback_data содержит двоеточие («19:00»), поэтому паттерн
  // \d\d:\d\d, а не [^:]+ — иначе «19:00:T5» режется на «19» и «00:T5»
  // (латентный баг старого формата, чинился здесь).
  bot.callbackQuery(/^bkc:([^:]+):(\d\d:\d\d):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, date, time, tableId] = ctx.match;
    const table = (await getTablesMerged()).find(t => t.id === tableId);
    const kb = new InlineKeyboard()
      .text('📨 Отправить заявку', `bkok:${date}:${time}:${tableId}`).row()
      .text('‹ Назад', `bkt:${date}:${time}`);
    return ctx.editMessageText(
      `Проверьте заявку:\n\n🪑 ${tableGuestLabel(table)}\n📅 ${fmtDate(date)}\n🕐 приход к ${time}\n\n`
      + 'Бронь подтверждает бармен — уведомление придёт сюда, в Telegram.',
      { reply_markup: kb, parse_mode: 'Markdown' },
    );
  });

  // booking: create — заявка pending, подтверждение за барменом
  bot.callbackQuery(/^bkok:([^:]+):(\d\d:\d\d):(.+)$/, async (ctx) => {
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
      const r = await createReservation({
        tableId, date, timeFrom: time,
        guestsCount: Math.min(2, cap || 1),
        guestName: ctx.from.first_name || 'Гость',
        source: 'telegram_bot', guestId: user.id,
      });
      await ctx.answerCallbackQuery({ text: 'Заявка отправлена!' });
      const kb = new InlineKeyboard().text('📋 Мои брони', 'my').text('🏠 Меню', 'menu');
      return ctx.editMessageText(
        `📨 *Заявка отправлена!*\n\n🪑 ${tableGuestLabel(table)}\n📅 ${fmtDate(date)} · приход к ${r.timeFrom}\n\n`
        + 'Бронь подтверждает бармен — обычно это занимает несколько минут. Уведомление придёт сюда 🎷',
        { reply_markup: kb, parse_mode: 'Markdown' },
      );
    } catch (e) {
      await ctx.answerCallbackQuery({ text: e.message || 'Ошибка', show_alert: true });
      const kb = new InlineKeyboard().text('‹ Выбрать заново', `bkt:${date}:${time}`);
      return ctx.editMessageText(`Не удалось отправить заявку: ${e.message}`, { reply_markup: kb });
    }
  });

  // my reservations — заявки и брони со статусами; сравнение времени через
  // reservationInstant (зона бара + ночные слоты), не naive Date
  bot.callbackQuery('my', async (ctx) => {
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
    const today = barEveningDate();
    const all = await getReservations({});
    const upcoming = all
      .filter(r => ['pending', 'confirmed', 'seated'].includes(r.status))
      .filter(r => r.date >= today)
      .sort((a, b) => (a.date + a.timeFrom < b.date + b.timeFrom ? -1 : 1))
      .slice(0, 10);
    if (!upcoming.length) {
      return ctx.editMessageText('Заявок нет.', { reply_markup: new InlineKeyboard().text('🏠 Меню', 'adminmenu') });
    }
    const kb = new InlineKeyboard();
    const lines = upcoming.map(r => {
      const src = r.source === 'telegram_bot' ? 'TG' : r.source === 'web' ? 'сайт' : 'звонок';
      const st = r.status === 'pending' ? '⏳' : r.status === 'seated' ? '🎷' : '✅';
      return `${st} ${r.tableId} · ${fmtDate(r.date)} ${r.timeFrom} · ${escapeMd(r.guestName)} · ${src}`;
    });
    upcoming.forEach(r => {
      kb.text(`❌ ${r.tableId} ${r.timeFrom}`, `admno:${r.id}`);
      if (r.status === 'pending') kb.text(`✅ ${r.tableId}`, `admok:${r.id}`);
      else kb.text('🏁 Завершить', `admdone:${r.id}`);
      kb.row();
    });
    kb.text('🏠 Меню', 'adminmenu');
    return ctx.editMessageText(`🛠 *Ближайшие заявки:*\n\n${lines.join('\n')}`, { reply_markup: kb, parse_mode: 'Markdown' });
  });

  bot.callbackQuery(/^admok:(.+)$/, async (ctx) => {
    if (!isTelegramAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    try {
      // тот же флоу, что кнопка в стафф-чате: правка заявки + уведомление гостю
      await performConfirm(ctx.match[1], staffName(ctx.from));
      await ctx.answerCallbackQuery({ text: 'Подтверждено — гость получил уведомление' });
    } catch (e) { await ctx.answerCallbackQuery({ text: e.message, show_alert: true }); }
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
    try {
      // performReject — гость получит извинение в ЛС, стафф-сообщение поправится
      await performReject(ctx.match[1], 'Отменена персоналом', staffName(ctx.from));
      await ctx.answerCallbackQuery({ text: 'Отменено — гость получил уведомление' });
    } catch (e) { await ctx.answerCallbackQuery({ text: e.message, show_alert: true }); }
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
    const rsvpKb = new InlineKeyboard().text('🙋 Я приду', `rsvp:${found.id}`);
    const { total, sent, blocked } = await sendBroadcast(ctx.api, eventBroadcastText(found, true), { replyMarkup: rsvpKb });
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
      const ev = await createEvent({ title: d.title, date: d.date, time: d.time, description: d.description, awardsPoints: d.awardsPoints });
      resetSession(ctx);
      const rsvpKb = new InlineKeyboard().text('🙋 Я приду', `rsvp:${ev.id}`);
      const { total, sent, blocked } = await sendBroadcast(ctx.api, eventBroadcastText(ev, false), { replyMarkup: rsvpKb });
      return ctx.editMessageText(
        `✅ Событие сохранено и разослано.\nПолучателей: ${total}, доставлено: ${sent}${blocked ? `, недоступно: ${blocked}` : ''}.`,
        { reply_markup: new InlineKeyboard().text('‹ К событиям', 'ev').text('🏠 Меню', 'adminmenu') },
      );
    } catch (e) {
      return ctx.editMessageText(`Не удалось сохранить: ${e.message}`, { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') });
    }
  });

  // Свободный текст: (1) причина отклонения заявки — бармен отвечает (Reply)
  // на промпт бота в стафф-группе; (2) шаги мастера «Добавить событие» (админ).
  bot.on('message:text', async (ctx) => {
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
      return ctx.reply(
        'Начислять баллы лояльности за участие в этом событии?\n\n'
        + 'Гости отмечаются кнопкой «🙋 Я приду» в рассылке, персонал потом подтверждает явку — баллы дадутся только тем, кого подтвердят, и только если тут «Да».',
        { reply_markup: new InlineKeyboard().text('Да', 'evpts:yes').text('Нет', 'evpts:no') },
      );
    }
  });

  bot.callbackQuery(/^evpts:(yes|no)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isTelegramAdmin(ctx.from.id)) return;
    const d = ctx.session.draft;
    if (!d?.title || !d?.date) {
      resetSession(ctx);
      return ctx.editMessageText('Черновик события утерян, начните заново.', { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') });
    }
    d.awardsPoints = ctx.match[1] === 'yes';
    const kb = new InlineKeyboard()
      .text('✅ Сохранить и разослать', 'evsave').row()
      .text('✏️ Начать заново', 'evadd').row()
      .text('‹ Отмена', 'evcancel');
    return ctx.editMessageText(
      `Проверьте событие:\n\n*${d.title}*\n📅 ${fmtEventDate(d.date)}${d.time ? ' ' + d.time : ''}\n${d.description || '(без описания)'}\n🎖 Баллы за участие: ${d.awardsPoints ? 'да' : 'нет'}\n\nСохранить и разослать подписчикам?`,
      { reply_markup: kb, parse_mode: 'Markdown' },
    );
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

  // ─── RSVP на события + подтверждение явки персоналом ────────────────────────
  // Гость жмёт «🙋 Я приду» в рассылке о событии — идемпотентно (повторный тап
  // тем же гостем не дублирует запись, см. rsvpToEvent/unique(event_id,guest_id)).
  bot.callbackQuery(/^rsvp:(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    try {
      const user = await ensureTelegramUser(ctx.from);
      const result = await rsvpToEvent(eventId, user.id, String(ctx.from.id));
      await ctx.answerCallbackQuery({ text: result ? 'Записал! Увидимся 🎷' : 'Вы уже записаны 🙌' });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: e.message || 'Не получилось записаться', show_alert: true });
    }
  });

  // Кнопки из уведомления attendancePoller.js «Проверка визита» (группа персонала,
  // тема «Брони») — гейт isTelegramStaff, а не isTelegramAdmin: бармены должны
  // уметь подтверждать явку, не имея доступа к остальной админке.
  bot.callbackQuery(/^att(yes|no):(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    const attended = ctx.match[1] === 'yes';
    try {
      await updateReservationStatus(ctx.match[2], attended ? 'completed' : 'no_show');
      await ctx.answerCallbackQuery({ text: attended ? 'Отмечено, баллы начислены' : 'Отмечено как неявка' });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: e.message, show_alert: true });
      return;
    }
    return ctx.editMessageText(
      ctx.callbackQuery.message.text + (attended ? '\n\n✅ Гость был.' : '\n\n❌ Гость не пришёл.'),
    );
  });

  // Кнопки из уведомления attendancePoller.js «Подтвердите явку» по событию —
  // одно сообщение на событие с рядом кнопок на каждого записавшегося гостя;
  // после подтверждения убираем только его ряд, остальные кнопки остаются.
  bot.callbackQuery(/^evatt(_no)?:(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    const attended = !ctx.match[1];
    const rsvpId = ctx.match[2];
    try {
      await confirmRsvp(rsvpId, attended);
      await ctx.answerCallbackQuery({ text: attended ? 'Отмечено: был' : 'Отмечено: не пришёл' });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: e.message, show_alert: true });
      return;
    }
    const rows = (ctx.callbackQuery.message.reply_markup?.inline_keyboard || [])
      .filter(row => !row.some(btn => btn.callback_data?.endsWith(`:${rsvpId}`)));
    if (rows.length) {
      return ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: rows } });
    }
    return ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ Все гости отмечены.');
  });

  // ─── бронирование v2: кнопки заявок в стафф-теме «Брони» ────────────────────
  bot.callbackQuery(/^stok:(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    try {
      await performConfirm(ctx.match[1], staffName(ctx.from));
      return ctx.answerCallbackQuery({ text: 'Подтверждено — гость получил уведомление' });
    } catch (e) {
      return answerAlreadyHandled(ctx, ctx.match[1], e);
    }
  });

  bot.callbackQuery(/^stno:(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    const id = ctx.match[1];
    const r = await getReservationById(id).catch(() => null);
    if (!r || r.status !== 'pending') {
      return answerAlreadyHandled(ctx, id, new Error('Заявка уже обработана'));
    }
    await ctx.answerCallbackQuery({ text: 'Выберите причину' });
    return ctx.editMessageReplyMarkup({ reply_markup: rejectReasonKeyboard(id) }).catch(() => {});
  });

  bot.callbackQuery(/^stnor:([^:]+):(nomest|closed)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    try {
      await performReject(ctx.match[1], REJECT_REASONS[ctx.match[2]], staffName(ctx.from));
      return ctx.answerCallbackQuery({ text: 'Отклонено — гость получил уведомление' });
    } catch (e) {
      return answerAlreadyHandled(ctx, ctx.match[1], e);
    }
  });

  // «Своя причина» — бармен отвечает (Reply) на промпт бота; Privacy Mode
  // доставляет боту реплаи на его сообщения даже без админ-прав в группе.
  bot.callbackQuery(/^stnor:([^:]+):custom$/, async (ctx) => {
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

  // «‹ Отмена» на самой заявке — вернуть обычные кнопки подтверждения
  bot.callbackQuery(/^stnoback:(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    const id = ctx.match[1];
    const r = await getReservationById(id).catch(() => null);
    if (!r || r.status !== 'pending') return answerAlreadyHandled(ctx, id, new Error('Заявка уже обработана'));
    await ctx.answerCallbackQuery();
    return ctx.editMessageReplyMarkup({ reply_markup: staffConfirmKeyboard(id) }).catch(() => {});
  });

  // «‹ Передумал» на промпте причины — бармен ушёл/передумал, состояние
  // «жду ввода причины» не должно застревать (§7.7 ТЗ)
  bot.callbackQuery(/^stnocancel:(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    resetSession(ctx);
    await ctx.answerCallbackQuery({ text: 'Отменено' });
    return ctx.deleteMessage().catch(() => {});
  });

  // ─── «Столы сейчас» — интерфейс бармена ──────────────────────────────────────
  async function renderTablesNow(ctx, { edit }) {
    const { text, kb } = await tablesNowContent();
    const opts = { reply_markup: kb, parse_mode: 'Markdown' };
    if (edit) {
      // повторный тап без изменений → Telegram ответит «message is not
      // modified» — глотаем, answerCallbackQuery уже дал фидбек
      return ctx.editMessageText(text, opts).catch(() => {});
    }
    return ctx.reply(text, { ...opts, message_thread_id: ctx.message?.message_thread_id });
  }

  bot.callbackQuery('tbl', async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    await ctx.answerCallbackQuery();
    return renderTablesNow(ctx, { edit: true });
  });

  bot.command('tables', async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return;
    return renderTablesNow(ctx, { edit: false });
  });

  bot.callbackQuery(/^tblocc:(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    try {
      const occupied = await setTableOccupied(ctx.match[1]);
      await ctx.answerCallbackQuery({ text: occupied ? 'Отмечен занятым (walk-in)' : 'Стол уже занят' });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: e.message, show_alert: true });
    }
    return renderTablesNow(ctx, { edit: true });
  });

  bot.callbackQuery(/^tblfree:(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    try {
      const freed = await freeTableOccupancy(ctx.match[1]);
      await ctx.answerCallbackQuery({ text: freed ? 'Стол свободен' : 'Стол уже свободен' });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: e.message, show_alert: true });
    }
    return renderTablesNow(ctx, { edit: true });
  });

  bot.callbackQuery(/^tblseat:(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    try {
      await updateReservationStatus(ctx.match[1], 'seated', { fromStatus: 'confirmed' });
      await ctx.answerCallbackQuery({ text: 'Гости за столом 🎷' });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: e.message, show_alert: true });
    }
    return renderTablesNow(ctx, { edit: true });
  });

  bot.callbackQuery(/^tbldone:(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    try {
      await updateReservationStatus(ctx.match[1], 'completed', { fromStatus: 'seated' });
      await ctx.answerCallbackQuery({ text: 'Стол свободен, гостю начислены баллы' });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: e.message, show_alert: true });
    }
    return renderTablesNow(ctx, { edit: true });
  });

  bot.callbackQuery(/^tblno:(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    try {
      await updateReservationStatus(ctx.match[1], 'no_show', { fromStatus: 'seated' });
      await ctx.answerCallbackQuery({ text: 'Отмечено: гости не пришли. Стол свободен, баллов нет' });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: e.message, show_alert: true });
    }
    return renderTablesNow(ctx, { edit: true });
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
