// One-off webhook management for the Telegram bot.
// The bot token lives only in Vercel env, so the server registers the webhook
// (we never need the token on a developer machine).
//
//   GET /api/bot-setup?key=<SESSION_SECRET>&action=set     → setWebhook
//   GET /api/bot-setup?key=<SESSION_SECRET>&action=info    → getWebhookInfo
//   GET /api/bot-setup?key=<SESSION_SECRET>&action=delete  → deleteWebhook
//
// Guarded by SESSION_SECRET so randoms can't repoint/remove the webhook.

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const SECRET  = process.env.TELEGRAM_WEBHOOK_SECRET;
const SITE    = process.env.PUBLIC_SITE_URL || 'https://cats-pajamas.ru';

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (!TOKEN) return res.status(500).end(JSON.stringify({ error: 'BOT token env not set (TELEGRAM_BOT_TOKEN / BOT_TOKEN)' }));
  if ((req.query.key || '') !== (process.env.SESSION_SECRET || '')) {
    return res.status(401).end(JSON.stringify({ error: 'bad key' }));
  }
  const action = req.query.action || 'info';
  try {
    let result;
    if (action === 'set') {
      result = await tg('setWebhook', {
        url: `${SITE}/api/bot`,
        secret_token: SECRET,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      });
    } else if (action === 'delete') {
      result = await tg('deleteWebhook', { drop_pending_updates: true });
    } else {
      result = await tg('getWebhookInfo');
    }
    return res.status(200).end(JSON.stringify({ action, result }, null, 2));
  } catch (e) {
    return res.status(500).end(JSON.stringify({ error: e.message }));
  }
}
