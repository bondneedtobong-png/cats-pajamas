// Fire-and-forget push notification to bot admins (outside any incoming
// Telegram update — a plain HTTPS call to sendMessage). Best-effort: a failed
// push (e.g. an admin never started the bot) must never fail the caller's
// request, so every error is swallowed here.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

/**
 * ЛС конкретному гостю по его telegram_id (chat_id ЛС = id пользователя).
 * Best-effort: гость мог не запускать бота / заблокировать его — тогда
 * Telegram вернёт ошибку, глотаем её (уведомление не критично для операции).
 */
/** ЛС гостю с картинкой (план зала с выделенным столом). Best-effort. */
export async function notifyGuestTgPhoto(telegramId, photoBuffer, caption, { replyMarkup } = {}) {
  if (!TOKEN || !telegramId) return false;
  try {
    const form = new FormData();
    form.append('chat_id', String(telegramId));
    form.append('photo', new Blob([photoBuffer], { type: 'image/png' }), 'plan.png');
    form.append('caption', caption);
    form.append('parse_mode', 'Markdown');
    if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
    const resp = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, { method: 'POST', body: form });
    const data = await resp.json().catch(() => null);
    return Boolean(data?.ok);
  } catch (e) {
    console.error('[telegramNotify] guest photo failed for', telegramId, e.message);
    return false;
  }
}

export async function notifyGuestTg(telegramId, text, { replyMarkup } = {}) {
  if (!TOKEN || !telegramId) return false;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'Markdown', reply_markup: replyMarkup }),
    });
    const data = await resp.json().catch(() => null);
    return Boolean(data?.ok);
  } catch (e) {
    console.error('[telegramNotify] guest DM failed for', telegramId, e.message);
    return false;
  }
}

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
