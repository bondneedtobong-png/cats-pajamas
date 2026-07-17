import { Bot, InlineKeyboard, InputFile, Keyboard, session } from 'grammy';
import { readBody } from './_lib/http.js';
import { ensureTelegramUser, isTelegramStaff, completeLoginToken, setUserPhone } from './_lib/auth.js';
import {
  getTablesWithStatusAdmin, getTablesMerged, getReservations, getReservationById,
  cancelReservation, updateReservationStatus,
  setTableOccupied, freeTableOccupancy,
  setTableDepositPrice, setTableSeatsCount,
  getBookingDatesConfig, setBookingDatesConfig,
  staffBookingText, staffConfirmKeyboard, tableGuestLabel, getGuestTelegramId,
} from './_lib/booking.js';
import { activeSeats } from '../src/booking/tablesConfig.js';
import {
  barEveningDate, upcomingEveningDates, reservationInstant,
  barNow, minToTime,
} from '../src/booking/barTime.js';
import { notifyGuestTg, notifyGuestTgPhoto } from './_lib/telegramNotify.js';
import { editStaffMessage, notifyStaff } from './_lib/staffNotify.js';
import { renderPlanPng } from './_lib/planImage.js';
import { getGuestLevel } from './_lib/loyalty.js';
import { getGuestContact } from './_lib/guests.js';
import { getEvents, createEvent } from './_lib/events.js';
import { saveEventPhoto, deleteEventPhoto, MAX_PHOTOS } from './_lib/eventPhotos.js';
import { rsvpToEvent } from './_lib/eventRsvps.js';
import { sendBroadcast, forwardBroadcast } from './_lib/broadcast.js';
import { supabaseSessionStorage } from './_lib/botSession.js';
import { createReview, checkReviewCooldown } from './_lib/reviews.js';

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const CHANNEL = process.env.TELEGRAM_CHANNEL;           // @catspajajam
const SECRET  = process.env.TELEGRAM_WEBHOOK_SECRET;
const CHANNEL_URL = CHANNEL ? `https://t.me/${CHANNEL.replace(/^@/, '')}` : '';
const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://cats-pajamas.ru';
const BAR_PHONE = '+7 (908) 418-00-09';

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
const STATUS_EMOJI = {
  pending: '⏳', confirmed: '✅', seated: '🎷', completed: '🏁', cancelled: '❌', no_show: '🚫',
};
function pluralBookings(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'бронь';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'брони';
  return 'броней';
}
function fmtEventDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
// Текст поста о событии — уходит и в канал, и в рассылку-напоминание.
// escapeMd обязателен: название/описание пишет админ свободным текстом,
// незакрытая '*'/'_' валит parse у Telegram, и пост не выходит вовсе.
function eventBroadcastText(ev, isReminder) {
  const head = isReminder ? '🎷 *Напоминаем о событии!*' : "🎷 *Новое событие в Cat's Pajamas Club!*";
  const time = ev.time ? ` в ${ev.time}` : '';
  const desc = ev.description ? `\n${escapeMd(ev.description)}` : '';
  return `${head}\n\n*${escapeMd(ev.title)}*\n📅 ${fmtEventDate(ev.date)}${time}${desc}\n\n🪑 Забронировать стол: ${SITE_URL}`;
}
function resetSession(ctx) { ctx.session.step = null; ctx.session.draft = {}; }

// id события генерим заранее (в шаге фото) — тем же форматом, что createEvent,
// чтобы фото легли в папку /uploads/events/<id>/ ещё до записи события в БД.
function genEventId() { return 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

// Скачать файл из Telegram по file_id → Buffer (getFile → ссылка на файл → байты).
async function downloadTelegramFile(api, fileId) {
  const file = await api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('download failed ' + resp.status);
  return Buffer.from(await resp.arrayBuffer());
}

// Шаг «фото» мастера события.
function eventPhotoStepText(n) {
  return n === 0
    ? 'Пришлите фото события — до 10, можно альбомом. Или нажмите «Без фото».'
    : `Фото ${n}/${MAX_PHOTOS} ✅. Пришлите ещё или нажмите «Готово».`;
}
function eventPhotoStepKb(n = 0) {
  const kb = new InlineKeyboard();
  if (n > 0) kb.text('✅ Готово', 'evphotosdone').row().text('🗑 Убрать последнее', 'evphotosundo').row();
  else kb.text('⏭ Без фото', 'evphotosdone').row();
  return kb.text('‹ Отмена', 'evcancel');
}

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
  // Вход в админ-панель — только персоналу (TELEGRAM_STAFF_IDS + админы);
  // «Столы сейчас» переехали внутрь панели (решение владельца, 2026-07-04).
  if (isStaff) kb.text('🛠 Админ-панель', 'adminmenu').row();
  return kb;
}

// Панель бармена/админа: столы, брони, настройка столов/дат, события, рассылка.
// Гейт — isTelegramStaff: владелец хочет, чтобы бармены управляли всем этим.
function adminMenu() {
  return new InlineKeyboard()
    .text('🍸 Столы сейчас', 'tbl').row()
    .text('📋 Текущие брони', 'adm').row()
    .text('🪑 Настроить столы', 'tblcfg').row()
    .text('📅 Даты брони', 'bdates').row()
    .text('📢 Событие', 'ev').row()
    .text('📨 Рассылка', 'bc').row()
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
    const depLine = r.depositPrice > 0 && r.depositStatus !== 'paid_mock'
      ? `💰 Депозит ${r.depositPrice} ₽ — оплатите на сайте в «Мои брони» (засчитывается в счёт заказа).\n`
      : '';
    const caption = `✅ *Бронь подтверждена!*\n\nЖдём вас ${fmtDate(r.date)} к ${r.timeFrom}.\n🪑 ${tableGuestLabel(table)}\n${depLine}\n`
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
async function tablesNowContent() {
  // Барные стулья (type='bar') не показываем: стойка не бронируется и walk-in
  // по отдельным стульям не отмечается — она всегда «просто приходите».
  const tables = (await getTablesWithStatusAdmin()).filter(t => t.type !== 'bar');
  const kb = new InlineKeyboard();
  const lines = [];
  for (const t of tables) {
    // зонная нумерация: «Зал 1», «Окно 3», «Диван 2»
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
  // (его фильтр не смотрит на тип чата) и тихо съедалось там (!isTelegramStaff
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

    const subbed = await isSubscribed(ctx.api, ctx.from.id);
    if (!subbed) {
      const g = subGate();
      return ctx.reply(g.text, { reply_markup: g.kb });
    }
    if (await proceedWebLogin(ctx)) return;
    await ensureTelegramUser(ctx.from);
    // Deep-link с плана зала на сайте («Большая компания? Напишите нам») —
    // сразу открываем текстовую заявку, минуя приветствие.
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

  bot.command('start', greet);

  bot.command('admin', async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return;
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

  // «Меню» внутри админ-экранов (tbl/adm/ev/bc) ведёт обратно в adminMenu,
  // а не в гостевое — иначе бармен терял бы доступ к своим кнопкам в один тап.
  // Сброс session.step — вход в панель из середины мастера (событие/рассылка)
  // должен выходить из мастера, как и «🏠 Меню».
  bot.callbackQuery('adminmenu', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isTelegramStaff(ctx.from.id)) return;
    resetSession(ctx);
    return ctx.editMessageText('🛠 *Админ-панель*', { reply_markup: adminMenu(), parse_mode: 'Markdown' }).catch(() => {});
  });

  // ─── «Забронировать текстом» — свободная заявка без выбора стола ───────────
  // Логика изменена 2026-07-04 (решение владельца): гость больше не выбирает
  // конкретный стол (для этого есть план зала в Mini App) — он пишет дату и
  // время, число гостей и сообщение, а бармены «что-нибудь придумают».
  // Заявка уходит в стафф-тему «Брони» как текст (в БД не пишется — стола нет).
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

  bot.callbackQuery('bk', async (ctx) => {
    await ctx.answerCallbackQuery();
    return freeBookingStart(ctx, { edit: true });
  });

  // Telegram не разрешает дефис в именах команд (только [a-z0-9_]) —
  // /booking_steps вместо /booking-steps.
  bot.command('booking_steps', (ctx) => freeBookingStart(ctx, { edit: false }));

  bot.callbackQuery('fbcancel', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Отменено' });
    resetSession(ctx);
    return ctx.editMessageText('Выберите действие:', { reply_markup: guestMenu(isTelegramStaff(ctx.from.id)) }).catch(() => {});
  });

  bot.callbackQuery('fbsend', async (ctx) => {
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
    resetSession(ctx);
    const sentId = await notifyStaff(staffText, { threadId: process.env.TELEGRAM_STAFF_BOOKINGS_THREAD_ID });
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

  // ─── «Мой уровень» — от числа подтверждённых броней (см. _lib/loyalty.js) ──
  bot.callbackQuery('loy', async (ctx) => {
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

  // ─── админ-панель: «Текущие брони» — список-кнопки → карточка брони ────────
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

  // Карточка брони: полная инфа (гость, телефон, @username, источник) +
  // действия по текущему статусу. После действия карточка перерисовывается.
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

  bot.callbackQuery('adm', async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    await ctx.answerCallbackQuery();
    const { text, kb } = await admListContent();
    // повторный тап «Обновить» без изменений → «message is not modified» — глотаем
    return ctx.editMessageText(text, { reply_markup: kb, parse_mode: 'Markdown' }).catch(() => {});
  });

  bot.callbackQuery(/^admv:(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    await ctx.answerCallbackQuery();
    const { text, kb } = await admDetailContent(ctx.match[1]);
    return ctx.editMessageText(text, { reply_markup: kb, parse_mode: 'Markdown' }).catch(() => {});
  });

  // Общий каркас действий из карточки: гейт → действие → перерисовать карточку.
  // Двойной тап и гонки статусов обрабатывает answerAlreadyHandled.
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

  bot.callbackQuery(/^admok:(.+)$/, (ctx) => admAction(ctx, ctx.match[1],
    // тот же флоу, что кнопка в стафф-чате: правка заявки + уведомление гостю
    () => performConfirm(ctx.match[1], staffName(ctx.from)),
    'Подтверждено — гость получил уведомление'));

  bot.callbackQuery(/^admno:(.+)$/, (ctx) => admAction(ctx, ctx.match[1],
    // performReject — гость получит извинение в ЛС, стафф-сообщение поправится
    () => performReject(ctx.match[1], 'Отменена персоналом', staffName(ctx.from)),
    'Отменено — гость получил уведомление'));

  bot.callbackQuery(/^admseat:(.+)$/, (ctx) => admAction(ctx, ctx.match[1],
    () => updateReservationStatus(ctx.match[1], 'seated', { fromStatus: 'confirmed' }),
    'Гости за столом 🎷'));

  bot.callbackQuery(/^admdone:(.+)$/, (ctx) => admAction(ctx, ctx.match[1],
    () => updateReservationStatus(ctx.match[1], 'completed', { fromStatus: 'seated' }),
    'Визит завершён — стол свободен'));

  bot.callbackQuery(/^admnoshow:(.+)$/, (ctx) => admAction(ctx, ctx.match[1],
    () => updateReservationStatus(ctx.match[1], 'no_show', { fromStatus: 'seated' }),
    'Отмечено: гости не пришли'));

  // ─── админ-панель: события (пост на сайт + в канал, опц. рассылка) ─────────
  const CANCEL_KB = new InlineKeyboard().text('‹ Отмена', 'evcancel');
  const eventsMenuKb = () => new InlineKeyboard()
    .text('➕ Создать событие', 'evadd').row()
    .text('📋 Ближайшие события', 'evlist').row()
    .text('‹ Назад', 'adminmenu');

  bot.callbackQuery('ev', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isTelegramStaff(ctx.from.id)) return;
    resetSession(ctx);
    return ctx.editMessageText(
      '📢 *События*\n\nНовое событие появится на сайте (страница «Афиша») и постом в канале. Рассылку подписчикам можно включить или выключить перед публикацией.',
      { reply_markup: eventsMenuKb(), parse_mode: 'Markdown' },
    );
  });

  bot.callbackQuery('evcancel', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Отменено' });
    if (!isTelegramStaff(ctx.from.id)) return;
    resetSession(ctx);
    return ctx.editMessageText('📢 *События*\n\nВыберите действие:', { reply_markup: eventsMenuKb(), parse_mode: 'Markdown' }).catch(() => {});
  });

  bot.callbackQuery('evadd', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isTelegramStaff(ctx.from.id)) return;
    ctx.session.step = 'ev_title';
    ctx.session.draft = {};
    return ctx.editMessageText('Введите название события:', { reply_markup: CANCEL_KB });
  });

  bot.callbackQuery('evlist', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isTelegramStaff(ctx.from.id)) return;
    const events = await getEvents({ upcomingOnly: true });
    const top = events.slice(0, 5);
    if (!top.length) {
      return ctx.editMessageText('Ближайших событий нет.', { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') });
    }
    const kb = new InlineKeyboard();
    const lines = top.map(e => `• ${escapeMd(e.title)} — ${fmtEventDate(e.date)}${e.time ? ' ' + e.time : ''}`);
    top.forEach(e => kb.text(`📢 Напомнить: ${e.title}`, `evre:${e.id}`).row());
    kb.text('‹ Назад', 'ev');
    return ctx.editMessageText(`📋 *Ближайшие события:*\n\n${lines.join('\n')}`, { reply_markup: kb, parse_mode: 'Markdown' });
  });

  bot.callbackQuery(/^evre:(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
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

  // Превью события перед публикацией: переключатель рассылки + публикация.
  function eventPreviewContent(d) {
    const kb = new InlineKeyboard()
      .text(d.notify ? '🔔 Рассылка подписчикам: ДА' : '🔕 Рассылка подписчикам: НЕТ', 'evnotify').row()
      .text('✅ Опубликовать', 'evsave').row()
      .text('✏️ Начать заново', 'evadd').row()
      .text('‹ Отмена', 'evcancel');
    const notifyLine = d.notify
      ? '🔔 Подписчикам придёт пересланный пост из канала.'
      : '🔕 Без рассылки в личку — только сайт и канал.';
    const nPhotos = d.photos?.length || 0;
    const photoLine = nPhotos ? `\n🖼 Фото: ${nPhotos}` : '';
    const text = `Проверьте событие:\n\n*${escapeMd(d.title)}*\n📅 ${fmtEventDate(d.date)}${d.time ? ' в ' + d.time : ''}\n${escapeMd(d.description) || '(без описания)'}${photoLine}\n\n`
      + `После публикации: событие на сайте + пост в канале${CHANNEL ? ' ' + CHANNEL : ''}.\n${notifyLine}`;
    return { text, kb };
  }

  // Превью показываем фото-сообщением, если есть фото (иначе текстом).
  function sendEventPreview(ctx, d) {
    const { text, kb } = eventPreviewContent(d);
    if (d.photos?.length) {
      return ctx.replyWithPhoto(d.photos[0].fileId, { caption: text, parse_mode: 'Markdown', reply_markup: kb });
    }
    return ctx.reply(text, { reply_markup: kb, parse_mode: 'Markdown' });
  }

  bot.callbackQuery('evnotify', async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    const d = ctx.session.draft;
    if (!d?.title || !d?.date) {
      await ctx.answerCallbackQuery();
      resetSession(ctx);
      return ctx.editMessageText('Черновик события утерян, начните заново.', { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') });
    }
    d.notify = !d.notify;
    await ctx.answerCallbackQuery({ text: d.notify ? 'Рассылка включена' : 'Рассылка выключена' });
    const { text, kb } = eventPreviewContent(d);
    // Превью-сообщение с фото → редактируем подпись, без фото → текст.
    const isPhoto = !!ctx.callbackQuery.message?.photo;
    const edit = isPhoto
      ? ctx.editMessageCaption({ caption: text, parse_mode: 'Markdown', reply_markup: kb })
      : ctx.editMessageText(text, { reply_markup: kb, parse_mode: 'Markdown' });
    return edit.catch(() => {});
  });

  bot.callbackQuery('evsave', async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    await ctx.answerCallbackQuery({ text: 'Публикую...' });
    const d = ctx.session.draft;
    if (!d?.title || !d?.date) {
      resetSession(ctx);
      return ctx.editMessageText('Черновик события утерян, начните заново.', { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') });
    }
    try {
      const photos = d.photos || [];
      const ev = await createEvent({
        id: d.eventId, title: d.title, date: d.date, time: d.time, description: d.description,
        imageUrls: photos.map(p => p.url),
      });
      const notify = !!d.notify;
      resetSession(ctx);
      const report = ['✅ Событие сохранено — уже видно на сайте (страница «Афиша»).'];

      // Пост в канал: 0 фото → текст, 1 → фото+подпись, 2+ → альбом + отдельный
      // анонс с кнопкой (у медиагрупп не бывает inline-кнопок). broadcastMsg —
      // что пересылать подписчикам (для альбома — анонс, его можно переслать).
      const caption = eventBroadcastText(ev, false);
      const rsvpKb = () => new InlineKeyboard().text('🙋 Я приду', `rsvp:${ev.id}`);
      let channelMsg = null;   // основной пост (для отчёта «опубликовано»)
      let broadcastMsg = null; // сообщение для пересылки в рассылке
      if (CHANNEL) {
        const onErr = (e) => { console.error('[bot] channel post failed:', e.message); return null; };
        if (photos.length === 0) {
          channelMsg = await ctx.api.sendMessage(CHANNEL, caption, { parse_mode: 'Markdown', reply_markup: rsvpKb() }).catch(onErr);
          broadcastMsg = channelMsg;
        } else if (photos.length === 1) {
          channelMsg = await ctx.api.sendPhoto(CHANNEL, photos[0].fileId, { caption, parse_mode: 'Markdown', reply_markup: rsvpKb() }).catch(onErr);
          broadcastMsg = channelMsg;
        } else {
          const media = photos.slice(0, MAX_PHOTOS).map((p, i) => (
            i === 0 ? { type: 'photo', media: p.fileId, caption, parse_mode: 'Markdown' } : { type: 'photo', media: p.fileId }
          ));
          const groupMsgs = await ctx.api.sendMediaGroup(CHANNEL, media).catch(onErr);
          channelMsg = Array.isArray(groupMsgs) ? groupMsgs[0] : null;
          // Отдельный анонс с кнопкой RSVP (медиагруппа кнопок не держит).
          broadcastMsg = await ctx.api.sendMessage(CHANNEL, `🎷 *${escapeMd(ev.title)}* — подробности и «Я приду» 👇`, { parse_mode: 'Markdown', reply_markup: rsvpKb() }).catch(onErr);
        }
        report.push(channelMsg
          ? `📢 Пост опубликован в канале ${CHANNEL}${photos.length ? ` (${photos.length} фото)` : ''}.`
          : `⚠️ Пост в канал ${CHANNEL} не ушёл — проверьте, что бот админ канала.`);
      }

      // Рассылка: пересылаем пост из канала (гость видит «Переслано из…»);
      // если поста нет — фолбэк на прямое сообщение с той же кнопкой RSVP.
      if (notify) {
        let stats;
        if (broadcastMsg) {
          stats = await forwardBroadcast(ctx.api, broadcastMsg.chat.id, broadcastMsg.message_id);
        } else {
          stats = await sendBroadcast(ctx.api, caption, { replyMarkup: rsvpKb() });
        }
        report.push(`📨 Уведомление подписчикам: доставлено ${stats.sent} из ${stats.total}${stats.blocked ? `, бот заблокирован у ${stats.blocked}` : ''}.`);
      }

      // Превью могло быть фото-сообщением → редактируем подпись, не текст.
      const doneKb = new InlineKeyboard().text('‹ К событиям', 'ev').text('🏠 Меню', 'adminmenu');
      return editPreviewMessage(ctx, report.join('\n'), doneKb);
    } catch (e) {
      return editPreviewMessage(ctx, `Не удалось сохранить: ${e.message}`, new InlineKeyboard().text('‹ Назад', 'ev'));
    }
  });

  // Редактировать превью-сообщение мастера (текст ИЛИ подпись фото) с фолбэком на reply.
  function editPreviewMessage(ctx, text, kb) {
    const isPhoto = !!ctx.callbackQuery?.message?.photo;
    const p = isPhoto
      ? ctx.editMessageCaption({ caption: text, reply_markup: kb })
      : ctx.editMessageText(text, { reply_markup: kb });
    return p.catch(() => ctx.reply(text, { reply_markup: kb }));
  }

  // ─── Мастер события: шаг «фото» ───────────────────────────────────────────
  // Фото приходят отдельными message:photo (в т.ч. альбомом — по одному).
  // grammY обрабатывает апдейты последовательно, поэтому счётчик/индекс файла
  // не гоняются. Черновик в persistent-сессии хранит только пути и file_id.
  bot.on('message:photo', async (ctx) => {
    if (ctx.session.step !== 'ev_photos') return; // фото вне мастера — игнор
    if (!isTelegramStaff(ctx.from.id)) return;
    const d = ctx.session.draft;
    d.photos = d.photos || [];
    if (!d.eventId) d.eventId = genEventId();
    if (d.photos.length >= MAX_PHOTOS) {
      return ctx.reply(`Уже ${MAX_PHOTOS} фото — это максимум. Нажмите «Готово».`, { reply_markup: eventPhotoStepKb(d.photos.length) });
    }
    try {
      const sizes = ctx.message.photo;            // размеры одного фото
      const largest = sizes[sizes.length - 1];    // самый большой
      const buffer = await downloadTelegramFile(ctx.api, largest.file_id);
      const saved = await saveEventPhoto(d.eventId, buffer);
      d.photos.push({ url: saved.url, fileId: largest.file_id });
    } catch (e) {
      console.error('[bot] event photo save failed:', e.message);
      return ctx.reply('Не смог скачать/сохранить фото, пришлите ещё раз.', { reply_markup: eventPhotoStepKb(d.photos.length) });
    }
    return ctx.reply(eventPhotoStepText(d.photos.length), { reply_markup: eventPhotoStepKb(d.photos.length) });
  });

  bot.callbackQuery('evphotosdone', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isTelegramStaff(ctx.from.id)) return;
    const d = ctx.session.draft;
    if (!d?.title || !d?.date) {
      resetSession(ctx);
      return ctx.editMessageText('Черновик события утерян, начните заново.', { reply_markup: new InlineKeyboard().text('‹ Назад', 'ev') }).catch(() => {});
    }
    d.notify = true; // по умолчанию рассылку шлём — выключается кнопкой в превью
    ctx.session.step = null;
    return sendEventPreview(ctx, d);
  });

  bot.callbackQuery('evphotosundo', async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery();
    const d = ctx.session.draft;
    if (d?.photos?.length) {
      const removed = d.photos.pop();
      await deleteEventPhoto(d.eventId, removed.url).catch(() => {});
      await ctx.answerCallbackQuery({ text: 'Убрал последнее фото' });
    } else {
      await ctx.answerCallbackQuery();
    }
    const n = d?.photos?.length || 0;
    return ctx.editMessageText(eventPhotoStepText(n), { reply_markup: eventPhotoStepKb(n) })
      .catch(() => ctx.reply(eventPhotoStepText(n), { reply_markup: eventPhotoStepKb(n) }));
  });

  // ─── админ-панель: произвольная рассылка (просто текст, без события) ───────
  const BC_CANCEL_KB = new InlineKeyboard().text('‹ Отмена', 'bccancel');

  bot.callbackQuery('bc', async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    await ctx.answerCallbackQuery();
    ctx.session.step = 'bc_text';
    ctx.session.draft = {};
    return ctx.editMessageText(
      '📨 *Рассылка*\n\nНапишите текст одним сообщением — он уйдёт в личку всем гостям, кто запускал бота. Перед отправкой покажу превью.',
      { reply_markup: BC_CANCEL_KB, parse_mode: 'Markdown' },
    );
  });

  bot.callbackQuery('bccancel', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Отменено' });
    if (!isTelegramStaff(ctx.from.id)) return;
    resetSession(ctx);
    return ctx.editMessageText('🛠 *Админ-панель*', { reply_markup: adminMenu(), parse_mode: 'Markdown' }).catch(() => {});
  });

  bot.callbackQuery('bcsend', async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    const d = ctx.session.draft;
    if (!d?.broadcastText) {
      await ctx.answerCallbackQuery();
      resetSession(ctx);
      return ctx.editMessageText('Текст рассылки утерян, начните заново.', {
        reply_markup: new InlineKeyboard().text('📨 Рассылка', 'bc').text('🏠 Меню', 'adminmenu'),
      });
    }
    await ctx.answerCallbackQuery({ text: 'Рассылаю...' });
    const textToSend = d.broadcastText;
    resetSession(ctx);
    // parseMode: null — текст уходит «как написан», без Markdown: произвольная
    // звёздочка/подчёркивание админа не должны валить отправку.
    const { total, sent, blocked } = await sendBroadcast(ctx.api, textToSend, { parseMode: null });
    return ctx.editMessageText(
      `✅ Рассылка отправлена.\nПолучателей: ${total}, доставлено: ${sent}${blocked ? `, бот заблокирован у ${blocked}` : ''}.`,
      { reply_markup: new InlineKeyboard().text('🏠 Меню', 'adminmenu') },
    );
  });

  // ─── админ-панель: настройка столов (депозит + число мест) ─────────────────
  const TC_CANCEL_KB = new InlineKeyboard().text('‹ Отмена', 'tblcfg');

  async function tblcfgContent() {
    const tables = (await getTablesMerged()).filter(t => t.type !== 'bar');
    const kb = new InlineKeyboard();
    for (const t of tables) {
      const dep = t.depositPrice > 0 ? `${t.depositPrice} ₽` : 'без депозита';
      kb.text(`${t.zoneShort} №${t.num} · ${dep} · ${activeSeats(t)} мест`, `tccard:${t.id}`).row();
    }
    kb.text('‹ Админ-панель', 'adminmenu');
    return {
      text: '🪑 *Настройка столов*\n\nНажмите на стол — придёт карточка с планом зала, депозитом и числом мест.',
      kb,
    };
  }

  bot.callbackQuery('tblcfg', async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    await ctx.answerCallbackQuery();
    resetSession(ctx);
    const { text, kb } = await tblcfgContent();
    // Сюда возвращаются и из фото-карточки стола — подпись фото в текст не
    // редактируется, поэтому шлём новое сообщение.
    if (ctx.callbackQuery.message?.photo) {
      return ctx.reply(text, { reply_markup: kb, parse_mode: 'Markdown' });
    }
    return ctx.editMessageText(text, { reply_markup: kb, parse_mode: 'Markdown' }).catch(() => {});
  });

  function tableCfgCaption(t) {
    return `🪑 *${t.zone}, №${t.num}*\n💰 Депозит: ${t.depositPrice > 0 ? t.depositPrice + ' ₽' : 'не нужен'}\n👥 Мест: ${activeSeats(t)}`;
  }
  function tableCfgKb(id) {
    return new InlineKeyboard()
      .text('💰 Изменить депозит', `tcdep:${id}`).row()
      .text('👥 Изменить места', `tcseats:${id}`).row()
      .text('‹ К столам', 'tblcfg');
  }

  // Карточка стола: фото плана с выделенным столом (как в заявках на бронь) —
  // бармен видит, какой именно стол настраивает. Сбой рендера → текст.
  bot.callbackQuery(/^tccard:(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    await ctx.answerCallbackQuery();
    const t = (await getTablesMerged()).find(x => x.id === ctx.match[1]);
    if (!t) return ctx.reply('Стол не найден.', { reply_markup: new InlineKeyboard().text('‹ К столам', 'tblcfg') });
    const opts = { caption: tableCfgCaption(t), reply_markup: tableCfgKb(t.id), parse_mode: 'Markdown' };
    try {
      const png = await renderPlanPng(t.id);
      return await ctx.replyWithPhoto(new InputFile(png, 'plan.png'), opts);
    } catch {
      return ctx.reply(opts.caption, { reply_markup: opts.reply_markup, parse_mode: 'Markdown' });
    }
  });

  bot.callbackQuery(/^tcdep:(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    await ctx.answerCallbackQuery();
    ctx.session.step = 'tc_deposit';
    ctx.session.draft = { tableId: ctx.match[1] };
    return ctx.reply('Введите сумму депозита в рублях (0 — без депозита):', { reply_markup: TC_CANCEL_KB });
  });

  bot.callbackQuery(/^tcseats:(.+)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    await ctx.answerCallbackQuery();
    ctx.session.step = 'tc_seats';
    ctx.session.draft = { tableId: ctx.match[1] };
    return ctx.reply('Сколько мест доступно за этим столом? Введите число от 1 до 30:', { reply_markup: TC_CANCEL_KB });
  });

  // ─── админ-панель: даты брони (закрытые даты + кнопки «Сегодня»/«Завтра») ──
  const BD_CANCEL_KB = new InlineKeyboard().text('‹ Отмена', 'bdates');

  async function bdatesContent() {
    const cfg = await getBookingDatesConfig();
    const days = upcomingEveningDates(7);
    const kb = new InlineKeyboard();
    kb.text(`Кнопка «Сегодня»: ${cfg.blockToday ? '🚫 закрыта' : '✅ открыта'}`, 'bdtoday').row();
    kb.text(`Кнопка «Завтра»: ${cfg.blockTomorrow ? '🚫 закрыта' : '✅ открыта'}`, 'bdtomorrow').row();
    days.forEach((d, i) => {
      kb.text(`${cfg.blockedDates.includes(d) ? '🚫' : '✅'} ${fmtEventDate(d).slice(0, 5)}`, `bdt:${d}`);
      if (i % 3 === 2) kb.row();
    });
    kb.row();
    // Закрытые даты за пределами недели — отдельными кнопками, чтобы снять
    for (const d of cfg.blockedDates.filter(x => !days.includes(x))) {
      kb.text(`🚫 ${fmtEventDate(d)} — открыть`, `bdt:${d}`).row();
    }
    kb.text('✍️ Закрыть другую дату', 'bdadd').row();
    kb.text('‹ Админ-панель', 'adminmenu');
    const text = '📅 *Даты брони*\n\n'
      + 'Нажмите на дату, чтобы закрыть или открыть её для броней (🚫 — брони не принимаются).\n\n'
      + 'Переключатели «Сегодня»/«Завтра» блокируют сами кнопки на сайте и переезжают на новый день автоматически: закрытое «сегодня» и завтра останется закрытым, пока вы его не откроете.';
    return { text, kb };
  }

  async function renderBdates(ctx) {
    const { text, kb } = await bdatesContent();
    return ctx.editMessageText(text, { reply_markup: kb, parse_mode: 'Markdown' }).catch(() => {});
  }

  bot.callbackQuery('bdates', async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    await ctx.answerCallbackQuery();
    resetSession(ctx);
    return renderBdates(ctx);
  });

  bot.callbackQuery(/^bd(today|tomorrow)$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    const key = ctx.match[1] === 'today' ? 'blockToday' : 'blockTomorrow';
    const cfg = await getBookingDatesConfig();
    const next = !cfg[key];
    await setBookingDatesConfig({ [key]: next });
    await ctx.answerCallbackQuery({ text: next ? 'Закрыто для брони' : 'Открыто для брони' });
    return renderBdates(ctx);
  });

  bot.callbackQuery(/^bdt:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    const iso = ctx.match[1];
    const cfg = await getBookingDatesConfig();
    const wasBlocked = cfg.blockedDates.includes(iso);
    await setBookingDatesConfig({
      blockedDates: wasBlocked ? cfg.blockedDates.filter(d => d !== iso) : [...cfg.blockedDates, iso],
    });
    await ctx.answerCallbackQuery({ text: wasBlocked ? 'Дата открыта' : 'Дата закрыта' });
    return renderBdates(ctx);
  });

  bot.callbackQuery('bdadd', async (ctx) => {
    if (!isTelegramStaff(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    await ctx.answerCallbackQuery();
    ctx.session.step = 'bd_date';
    ctx.session.draft = {};
    return ctx.reply(
      'Введите дату в формате ДД.ММ.ГГГГ — она закроется для брони (повторный ввод той же даты откроет её):',
      { reply_markup: BD_CANCEL_KB },
    );
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

    // Шаги гостевой текстовой заявки (fb_*) — доступны ЛЮБОМУ гостю,
    // поэтому обрабатываются ДО стафф-гейта ниже.
    const guestStep = ctx.session.step;
    if (guestStep === 'fb_when' || guestStep === 'fb_guests' || guestStep === 'fb_msg') {
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
      // fb_msg — финал: превью и подтверждение
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

    if (!isTelegramStaff(ctx.from.id)) return;
    const step = ctx.session.step;
    if (!step) return;
    const text = ctx.message.text.trim();

    if (text === '/cancel') {
      resetSession(ctx);
      return ctx.reply('Отменено.', { reply_markup: adminMenu() });
    }

    // Настройка столов: депозит / число мест (draft.tableId выставлен кнопкой)
    if (step === 'tc_deposit' || step === 'tc_seats') {
      const tableId = ctx.session.draft.tableId;
      const table = (await getTablesMerged()).find(t => t.id === tableId);
      if (!table) {
        resetSession(ctx);
        return ctx.reply('Стол не найден, начните заново.', { reply_markup: adminMenu() });
      }
      const label = `${table.zoneShort} №${table.num}`;
      const doneKb = new InlineKeyboard().text('🪑 К столам', 'tblcfg').text('🏠 Меню', 'adminmenu');
      if (step === 'tc_deposit') {
        const n = parseInt(text.replace(/\D/g, ''), 10);
        if (!Number.isFinite(n) || n < 0 || n > 1000000) {
          return ctx.reply('Введите сумму в рублях числом (0 — без депозита):', { reply_markup: TC_CANCEL_KB });
        }
        await setTableDepositPrice(tableId, n);
        resetSession(ctx);
        return ctx.reply(`Готово: ${label} — депозит ${n > 0 ? n + ' ₽' : 'не нужен'}.`, { reply_markup: doneKb });
      }
      const n = parseInt(text.replace(/\D/g, ''), 10);
      try {
        await setTableSeatsCount(tableId, n);
      } catch (e) {
        return ctx.reply(`${e.message}. Введите число мест:`, { reply_markup: TC_CANCEL_KB });
      }
      resetSession(ctx);
      return ctx.reply(`Готово: ${label} — ${n} мест.`, { reply_markup: doneKb });
    }

    // Даты брони: закрыть/открыть произвольную дату вводом ДД.ММ.ГГГГ
    if (step === 'bd_date') {
      const m = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : null;
      if (!iso || Number.isNaN(new Date(iso).getTime())) {
        return ctx.reply('Введите дату в формате ДД.ММ.ГГГГ, например 15.08.2026:', { reply_markup: BD_CANCEL_KB });
      }
      const cfg = await getBookingDatesConfig();
      const wasBlocked = cfg.blockedDates.includes(iso);
      await setBookingDatesConfig({
        blockedDates: wasBlocked ? cfg.blockedDates.filter(d => d !== iso) : [...cfg.blockedDates, iso],
      });
      resetSession(ctx);
      const { text: bdText, kb: bdKb } = await bdatesContent();
      await ctx.reply(wasBlocked ? `Дата ${text} снова открыта для брони.` : `Дата ${text} закрыта для брони.`);
      return ctx.reply(bdText, { reply_markup: bdKb, parse_mode: 'Markdown' });
    }

    // Мастер рассылки: один шаг — текст, дальше превью с подтверждением.
    if (step === 'bc_text') {
      ctx.session.draft.broadcastText = text.slice(0, 3500);
      ctx.session.step = null;
      const kb = new InlineKeyboard()
        .text('✅ Разослать', 'bcsend').row()
        .text('✏️ Изменить текст', 'bc').row()
        .text('‹ Отмена', 'bccancel');
      return ctx.reply(`Гости получат это сообщение:\n\n${ctx.session.draft.broadcastText}\n\nОтправляем?`, { reply_markup: kb });
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
      ctx.session.draft.eventId = ctx.session.draft.eventId || genEventId();
      ctx.session.draft.photos = ctx.session.draft.photos || [];
      ctx.session.step = 'ev_photos';
      return ctx.reply(eventPhotoStepText(0), { reply_markup: eventPhotoStepKb(0) });
    }
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

  // Кнопки «Гость был?» из старых сообщений поллера «Проверка визита» (сам
  // поллер отключён в бронировании v2, но старые сообщения в группе персонала
  // могли остаться — обрабатываем, чтобы кнопка не выглядела мёртвой).
  bot.callbackQuery(/^att(yes|no):(.+)$/, async (ctx) => {
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
      await ctx.answerCallbackQuery({ text: 'Визит завершён — стол свободен' });
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
