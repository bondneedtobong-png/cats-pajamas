// Fire-and-forget push в приватную группу персонала (отдельную от гостевой
// группы отзывов, см. GUIDE_STAFF_NOTIFICATIONS.md) — прямой HTTPS-вызов
// sendMessage, без ctx.api (нужно вызывать и оттуда, где нет живого апдейта
// бота, например из booking.js при создании брони). Тот же fire-and-forget
// принцип, что в telegramNotify.js: сбой пуша никогда не должен ронять
// вызывающий код, поэтому все ошибки глотаются здесь же.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const STAFF_CHAT_ID = process.env.TELEGRAM_STAFF_CHAT_ID;

export async function notifyStaff(text, { threadId, replyMarkup } = {}) {
  if (!TOKEN || !STAFF_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: STAFF_CHAT_ID,
        text,
        parse_mode: 'Markdown',
        message_thread_id: threadId ? Number(threadId) : undefined,
        reply_markup: replyMarkup,
      }),
    });
  } catch (e) {
    console.error('[staffNotify] failed:', e.message);
  }
}
