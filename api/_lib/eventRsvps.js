import { supabase } from './supabase.js';

// RSVP на события — «🙋 Я приду» под постом/рассылкой бота. С выводом баллов
// из продукта (2026-07-04) подтверждение явки персоналом убрано: запись «я
// приду» осталась как сигнал интереса для владельца, ничего начислять больше
// не нужно. Статусы attended/no_show в таблице — история старого флоу.

function generateId() { return 'rsvp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

function rowToRsvp(r) {
  return {
    id: r.id,
    eventId: r.event_id,
    guestId: r.guest_id,
    telegramId: r.telegram_id,
    status: r.status,
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at || null,
  };
}

// Идемпотентно — повторное нажатие «Я приду» тем же гостем не создаёт дубль
// (unique(event_id, guest_id) в схеме).
export async function rsvpToEvent(eventId, guestId, telegramId) {
  const { data, error } = await supabase.from('event_rsvps')
    .upsert(
      { id: generateId(), event_id: eventId, guest_id: guestId, telegram_id: telegramId, status: 'going' },
      { onConflict: 'event_id,guest_id', ignoreDuplicates: true },
    )
    .select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToRsvp(data) : null;
}
