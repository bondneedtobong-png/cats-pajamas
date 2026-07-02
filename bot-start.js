// VPS entry point for the bot — long polling instead of the Vercel webhook
// (api/bot.js's default export). No public HTTPS endpoint needed for the bot
// specifically; see HANDOFF_CATS_PAJAMAS.md "VPS-миграция". Same buildBot()
// as the webhook version — logic is untouched, only the transport differs.
import { buildBot } from './api/bot.js';

const bot = buildBot();

bot.catch((err) => console.error('[bot-start] unhandled error:', err));

bot.start({
  onStart: (info) => console.log(`[bot-start] long polling started as @${info.username}`),
  drop_pending_updates: true, // не хотим внезапно "выстрелить" пачкой апдейтов, скопившихся, пока вебхук на Vercel был выключен при переезде
});
