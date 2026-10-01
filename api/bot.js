import { Bot, session } from 'grammy';
import { readBody } from './_lib/http.js';
import { supabaseSessionStorage } from './_lib/botSession.js';
import { TOKEN, SECRET } from './bot/helpers.js';

import { reviewsComposer } from './bot/reviews.js';
import { guestComposer } from './bot/guest.js';
import { adminComposer } from './bot/admin.js';
import { staffReservationsComposer } from './bot/staffReservations.js';
import { tablesNowComposer } from './bot/tablesNow.js';
import { tableConfigComposer } from './bot/tableConfig.js';
import { eventsAndBroadcastComposer } from './bot/eventsAndBroadcast.js';

let _bot = null;
let _inited = false;

export function buildBot() {
  const bot = new Bot(TOKEN);

  // Персистентная сессия (переживает холодный старт serverless-функции) —
  // хранится в app_config: bot_session:<chatId>
  bot.use(session({
    initial: () => ({ step: null, draft: {}, loginToken: null }),
    storage: supabaseSessionStorage(),
  }));

  // 1. «Полка воспоминаний»: отзывы из Telegram-обсуждения канала
  // (строго до других текстовых обработчиков для корректной фильтрации групп)
  bot.use(reviewsComposer);

  // 2. Гостевой интерфейс: приветствие, меню, брони, лояльность, RSVP, текстовые заявки
  bot.use(guestComposer);

  // 3. Главная навигация панели администратора/персонала (/admin, adminmenu)
  bot.use(adminComposer);

  // 4. Управление бронями персонала: кнопки в стафф-чате + список «Текущие брони»
  bot.use(staffReservationsComposer);

  // 5. «Столы сейчас» — оперативный контроль занятости (walk-in)
  bot.use(tablesNowComposer);

  // 6. Настройка столов (депозиты, места) и дат бронирования
  bot.use(tableConfigComposer);

  // 7. События с фото, анонсы в канал и рассылки
  bot.use(eventsAndBroadcastComposer);

  bot.catch((err) => console.error('[bot] error:', err?.error || err));
  return bot;
}

async function getBot() {
  if (!_bot) _bot = buildBot();
  if (!_inited) { await _bot.init(); _inited = true; }
  return _bot;
}

// ─── Vercel webhook handler (для serverless-окружения) ───────────────────────
export default async function handler(req, res) {
  if (req.method === 'GET') { res.status(200).end("Cat's Pajamas bot webhook"); return; }
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
