// Fire-and-forget push notification to bot admins (outside any incoming
// Telegram update — a plain HTTPS call to sendMessage). Best-effort: a failed
// push (e.g. an admin never started the bot) must never fail the caller's
// request, so every error is swallowed here.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

export async function notifyAdmins(text) {
  if (!TOKEN || !ADMIN_IDS.length) return;
  await Promise.all(ADMIN_IDS.map(async (chatId) => {
    try {
      await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      });
    } catch (e) {
      console.error('[telegramNotify] failed for', chatId, e.message);
    }
  }));
}
