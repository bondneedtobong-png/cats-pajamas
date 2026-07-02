import { supabase } from './supabase.js';
import { awardAttendancePoints } from './loyalty.js';

// RSVP на события ("🙋 Я приду" в рассылке бота) + подтверждение явки
// персоналом (см. attendancePoller.js). Баллы начисляются только если
// у события awards_points=true (опция при создании, не для всех событий).

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

export async function getPendingRsvps(eventId) {
  const { data, error } = await supabase.from('event_rsvps')
    .select('*').eq('event_id', eventId).eq('status', 'going').order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const rsvps = (data || []).map(rowToRsvp);
  if (!rsvps.length) return rsvps;
  const guestIds = [...new Set(rsvps.map(r => r.guestId).filter(Boolean))];
  const { data: users } = await supabase.from('users').select('id, name').in('id', guestIds);
  const nameById = Object.fromEntries((users || []).map(u => [u.id, u.name]));
  return rsvps.map(r => ({ ...r, guestName: nameById[r.guestId] || 'Гость' }));
}

export async function confirmRsvp(rsvpId, attended) {
  const { data: existing, error: e1 } = await supabase.from('event_rsvps').select('*').eq('id', rsvpId).maybeSingle();
  if (e1 || !existing) throw new Error('RSVP не найден');
  // Тот же принцип, что у брони — не даёт повторным нажатием кнопки
  // задвоить начисление баллов.
  if (existing.status !== 'going') throw new Error('RSVP уже обработан — обновите список');

  const newStatus = attended ? 'attended' : 'no_show';
  const { data, error } = await supabase.from('event_rsvps')
    .update({ status: newStatus, confirmed_at: new Date().toISOString() })
    .eq('id', rsvpId).select().single();
  if (error) throw new Error(error.message);

  if (attended && existing.guest_id) {
    const { data: ev } = await supabase.from('events').select('awards_points').eq('id', existing.event_id).maybeSingle();
    if (ev?.awards_points) {
      awardAttendancePoints(existing.guest_id, { sourceId: rsvpId, reason: 'Явка на событие подтверждена' })
        .catch(e => console.error('[loyalty] award failed:', e.message));
    }
  }
  return rowToRsvp(data);
}
