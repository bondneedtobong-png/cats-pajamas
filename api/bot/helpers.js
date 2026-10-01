import { InlineKeyboard, Keyboard } from 'grammy';
import { ensureTelegramUser, completeLoginToken } from '../_lib/auth.js';
import { getTablesMerged } from '../_lib/booking.js';
import { barEveningDate } from '../../src/booking/barTime.js';

export const TOKEN   = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
export const CHANNEL = process.env.TELEGRAM_CHANNEL;           // @catspajajam
export const SECRET  = process.env.TELEGRAM_WEBHOOK_SECRET;
export const CHANNEL_URL = CHANNEL ? `https://t.me/${CHANNEL.replace(/^@/, '')}` : '';
export const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://cats-pajamas.ru';
export const BAR_PHONE = '+7 (908) 418-00-09';

// Ссылка на конкретный пост канала: t.me/<канал>/<message_id>.
export function channelPostUrl(messageId) {
  if (!CHANNEL || !messageId) return '';
  const name = String(CHANNEL).replace(/^@/, '');
  if (!/^[A-Za-z][\w]{3,}$/.test(name)) return '';
  return `https://t.me/${name}/${messageId}`;
}

// Дата вечера (зона Самары — см. barTime.js)
export function fmtDate(d) {
  const diff = Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(barEveningDate() + 'T00:00:00Z')) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  const [, m, day] = d.split('-');
  return `${day}.${m}`;
}

export function escapeMd(s) { return String(s || '').replace(/([_*[\]`])/g, '\\$1'); }

export function staffName(from) {
  return escapeMd(from.username ? '@' + from.username : from.first_name || 'бармен');
}

export const STATUS_LABEL = {
  pending: 'ждёт подтверждения', confirmed: 'подтверждена', seated: 'гости за столом',
  completed: 'завершена', cancelled: 'отменена', no_show: 'гость не пришёл',
};

export const STATUS_EMOJI = {
  pending: '⏳', confirmed: '✅', seated: '🎷', completed: '🏁', cancelled: '❌', no_show: '🚫',
};

export function pluralBookings(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'бронь';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'брони';
  return 'броней';
}

export function fmtEventDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function eventBroadcastText(ev, isReminder) {
  const head = isReminder ? '🎷 *Напоминаем о событии!*' : "🎷 *Новое событие в Cat's Pajamas Club!*";
  const time = ev.time ? ` в ${ev.time}` : '';
  const desc = ev.description ? `\n${escapeMd(ev.description)}` : '';
  return `${head}\n\n*${escapeMd(ev.title)}*\n📅 ${fmtEventDate(ev.date)}${time}${desc}\n\n🪑 Забронировать стол: ${SITE_URL}`;
}

export function resetSession(ctx) { ctx.session.step = null; ctx.session.draft = {}; }

export function genEventId() { return 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

export async function downloadTelegramFile(api, fileId) {
  const file = await api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('download failed ' + resp.status);
  return Buffer.from(await resp.arrayBuffer());
}

export async function proceedWebLogin(ctx) {
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

export async function isSubscribed(api, userId) {
  if (!CHANNEL) return true;
  try {
    const m = await api.getChatMember(CHANNEL, userId);
    if (['creator', 'administrator', 'member'].includes(m.status)) return true;
    if (m.status === 'restricted') return m.is_member !== false;
    return false;
  } catch {
    return false;
  }
}

export function guestMenu(isStaff = false) {
  const kb = new InlineKeyboard()
    .webApp("🪑 Открыть Cat's Pajamas", `${SITE_URL}/app`).row()
    .text('📝 Забронировать текстом', 'bk').row()
    .text('📋 Мои брони', 'my').row()
    .text('🎖 Мой уровень', 'loy').row();
  if (isStaff) kb.text('🛠 Админ-панель', 'adminmenu').row();
  return kb;
}

export function adminMenu() {
  return new InlineKeyboard()
    .text('🍸 Столы сейчас', 'tbl').row()
    .text('📋 Текущие брони', 'adm').row()
    .text('🪑 Настроить столы', 'tblcfg').row()
    .text('📅 Даты брони', 'bdates').row()
    .text('📢 Событие', 'ev').row()
    .text('📨 Рассылка', 'bc').row()
    .text('🏠 Обычное меню', 'menu');
}

export function persistentKeyboard() {
  return new Keyboard()
    .webApp('🪑 Открыть', `${SITE_URL}/app`)
    .text('🏠 Меню')
    .resized()
    .persistent();
}

export function subGate() {
  const kb = new InlineKeyboard()
    .url('Открыть канал', CHANNEL_URL).row()
    .text('Я подписался ✅', 'sub').row();
  return {
    text: `Чтобы бронировать через бота, подпишитесь на наш канал ${CHANNEL}.\n\nЭто способ сказать спасибо постоянным гостям 🎷`,
    kb,
  };
}

export async function findTable(tableId) {
  return (await getTablesMerged()).find(t => t.id === tableId);
}

export const REJECT_REASONS = { nomest: 'Нет свободных мест', closed: 'Закрытое мероприятие' };

export function rejectReasonKeyboard(id) {
  return new InlineKeyboard()
    .text('Нет свободных мест', `stnor:${id}:nomest`).row()
    .text('Закрытое мероприятие', `stnor:${id}:closed`).row()
    .text('✍️ Своя причина', `stnor:${id}:custom`).row()
    .text('‹ Отмена', `stnoback:${id}`);
}
