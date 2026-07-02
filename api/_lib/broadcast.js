import { supabase } from './supabase.js';

// Рассылка всем, кто хоть раз запускал бота (есть telegram_id в users).
// Шлём чанками с паузой, чтобы не упереться в лимиты Telegram (~30 msg/sec).
// Гостей, заблокировавших бота (403), помечаем bot_blocked и больше не трогаем.
const CHUNK_SIZE = 25;
const CHUNK_DELAY_MS = 1000;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function getBroadcastRecipients() {
  const { data, error } = await supabase.from('users')
    .select('id, telegram_id')
    .not('telegram_id', 'is', null)
    .eq('bot_blocked', false);
  if (error) throw new Error(error.message);
  return data || [];
}

/** @param api ctx.api (grammY Api instance) */
export async function sendBroadcast(api, text, { replyMarkup } = {}) {
  const recipients = await getBroadcastRecipients();
  let sent = 0, blocked = 0;

  for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
    const batch = recipients.slice(i, i + CHUNK_SIZE);
    const results = await Promise.allSettled(
      batch.map(u => api.sendMessage(u.telegram_id, text, { parse_mode: 'Markdown', reply_markup: replyMarkup })),
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') { sent++; continue; }
      if (r.reason?.error_code === 403) {
        blocked++;
        await supabase.from('users').update({ bot_blocked: true }).eq('id', batch[j].id);
      }
    }
    if (i + CHUNK_SIZE < recipients.length) await sleep(CHUNK_DELAY_MS);
  }
  return { total: recipients.length, sent, blocked };
}
