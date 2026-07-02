// VPS entry point for the bot — long polling instead of the Vercel webhook
// (api/bot.js's default export). No public HTTPS endpoint needed for the bot
// specifically; see HANDOFF_CATS_PAJAMAS.md "VPS-миграция". Same buildBot()
// as the webhook version — logic is untouched, only the transport differs.
import 'dotenv/config'; // must run before api/bot.js reads process.env at import time
import { buildBot } from './api/bot.js';
import { checkPendingBookings, checkPendingEventRsvps } from './api/_lib/attendancePoller.js';

const bot = buildBot();

bot.catch((err) => console.error('[bot-start] unhandled error:', err));

const ATTENDANCE_POLL_MS = 5 * 60 * 1000;

bot.start({
  onStart: (info) => {
    console.log(`[bot-start] long polling started as @${info.username}`);
    // Впервые возможно на VPS (персистентный процесс, не serverless-функция
    // на Vercel) — периодически проверяем брони/RSVP, чьё время прошло, и
    // шлём персоналу запрос подтвердить явку. Каждая обёрнута try/catch внутри
    // себя же — сбой одного цикла не должен останавливать следующий.
    setInterval(() => {
      checkPendingBookings().catch(e => console.error('[bot-start] checkPendingBookings failed:', e.message));
      checkPendingEventRsvps().catch(e => console.error('[bot-start] checkPendingEventRsvps failed:', e.message));
    }, ATTENDANCE_POLL_MS);
  },
  drop_pending_updates: true, // не хотим внезапно "выстрелить" пачкой апдейтов, скопившихся, пока вебхук на Vercel был выключен при переезде
});
