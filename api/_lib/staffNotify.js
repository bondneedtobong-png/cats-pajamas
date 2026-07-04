// Fire-and-forget push в приватную группу персонала (отдельную от гостевой
// группы отзывов, см. GUIDE_STAFF_NOTIFICATIONS.md) — прямой HTTPS-вызов
// sendMessage, без ctx.api (нужно вызывать и оттуда, где нет живого апдейта
// бота, например из booking.js при создании брони). Тот же fire-and-forget
// принцип, что в telegramNotify.js: сбой пуша никогда не должен ронять
// вызывающий код, поэтому все ошибки глотаются здесь же.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const STAFF_CHAT_ID = process.env.TELEGRAM_STAFF_CHAT_ID;

/**
 * Возвращает message_id отправленного сообщения (или null при сбое/пустых env) —
 * бронирование v2 хранит его в reservations.staff_message_id, чтобы позже
 * отредактировать заявку («отменена гостем», «протухла»).
 */
export async function notifyStaff(text, { threadId, replyMarkup } = {}) {
  if (!TOKEN || !STAFF_CHAT_ID) {
    // Стафф-чат не настроен — деградируем мягко: бронь создаётся, персонал
    // просто не получает push (см. HANDOFF_BOOKING_V2.md §7.9).
    console.warn('[staffNotify] TELEGRAM_STAFF_CHAT_ID/token не заданы — уведомление пропущено');
    return null;
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
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
    const data = await resp.json().catch(() => null);
    return data?.ok ? data.result?.message_id ?? null : null;
  } catch (e) {
    console.error('[staffNotify] failed:', e.message);
    return null;
  }
}

/**
 * Заявка с картинкой плана (выделенный стол): sendPhoto + caption + кнопки.
 * Возвращает message_id или null — вызывающий при null падает обратно на
 * текстовый notifyStaff.
 */
export async function notifyStaffPhoto(photoBuffer, caption, { threadId, replyMarkup } = {}) {
  if (!TOKEN || !STAFF_CHAT_ID) {
    console.warn('[staffNotify] TELEGRAM_STAFF_CHAT_ID/token не заданы — уведомление пропущено');
    return null;
  }
  try {
    const form = new FormData();
    form.append('chat_id', STAFF_CHAT_ID);
    form.append('photo', new Blob([photoBuffer], { type: 'image/png' }), 'plan.png');
    form.append('caption', caption);
    form.append('parse_mode', 'Markdown');
    if (threadId) form.append('message_thread_id', String(Number(threadId)));
    if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
    const resp = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, { method: 'POST', body: form });
    const data = await resp.json().catch(() => null);
    return data?.ok ? data.result?.message_id ?? null : null;
  } catch (e) {
    console.error('[staffNotify] photo failed:', e.message);
    return null;
  }
}

/**
 * Правка ранее отправленного стафф-сообщения (по сохранённому message_id).
 * Используется, когда заявку меняет НЕ нажатие кнопки в самом сообщении:
 * отмена гостем, авто-протухание, подтверждение из админ-списка.
 * Заявки теперь уходят фото+caption → сначала editMessageCaption; для
 * старых текстовых сообщений фолбэк на editMessageText.
 * replyMarkup не передан → кнопки снимаются.
 */
export async function editStaffMessage(messageId, text, { replyMarkup } = {}) {
  if (!TOKEN || !STAFF_CHAT_ID || !messageId) return;
  const call = (method, field) => fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: STAFF_CHAT_ID,
      message_id: Number(messageId),
      [field]: text,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup,
    }),
  }).then(r => r.json().catch(() => null));
  try {
    const first = await call('editMessageCaption', 'caption');
    if (!first?.ok) await call('editMessageText', 'text');
  } catch (e) {
    console.error('[staffNotify] edit failed:', e.message);
  }
}
