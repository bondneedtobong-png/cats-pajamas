import { supabase } from './supabase.js';
import { CONFIRMED_STATUSES, LEVELS, levelForBookings, levelByNum } from './loyalty.js';
import { getReservations } from './booking.js';

// Админский справочник гостей: список всех зарегистрированных с уровнем,
// числом подтверждённых броней, telegram-юзернеймом и датой регистрации.
// Уровень вычисляется из reservations на каждый запрос (см. loyalty.js) —
// для масштаба бара это дешевле и надёжнее, чем поддерживать счётчик.

function rowToGuest(u, bookings) {
  const auto = levelForBookings(bookings);
  const override = u.level_override ? levelByNum(u.level_override) : null;
  const level = (override && override.num > auto.num) ? override : auto;
  return {
    id: u.id,
    name: u.name || '',
    phone: u.phone || '',
    telegramId: u.telegram_id || null,
    telegramUsername: u.telegram_username || null,
    role: u.role || 'guest',
    createdAt: u.created_at,
    bookings,
    level: { num: level.num, label: level.label, emoji: level.emoji },
    levelOverride: u.level_override || null,
  };
}

export async function listGuests() {
  const [{ data: users, error }, { data: resRows, error: e2 }] = await Promise.all([
    supabase.from('users').select('*'),
    supabase.from('reservations').select('guest_id, status').in('status', CONFIRMED_STATUSES),
  ]);
  if (error) throw new Error(error.message);
  if (e2) throw new Error(e2.message);
  const countByGuest = {};
  for (const r of resRows || []) {
    if (!r.guest_id) continue;
    countByGuest[r.guest_id] = (countByGuest[r.guest_id] || 0) + 1;
  }
  return (users || []).map(u => rowToGuest(u, countByGuest[u.id] || 0));
}

/** Ручная правка уровня (1–9) или возврат на «авто» (levelNum = null). */
export async function setGuestLevel(userId, levelNum) {
  let value = null;
  if (levelNum !== null && levelNum !== undefined && levelNum !== '') {
    const lvl = levelByNum(levelNum);
    if (!lvl) throw new Error(`Уровень должен быть от 1 до ${LEVELS.length}`);
    value = lvl.num;
  }
  const { data, error } = await supabase.from('users')
    .update({ level_override: value }).eq('id', userId).select().maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Гость не найден');
  return { ok: true };
}

/** История броней гостя для карточки в админке, свежие сверху. */
export async function getGuestHistory(guestId) {
  const rows = await getReservations({ guestId });
  return rows.sort((a, b) => (a.date + a.timeFrom < b.date + b.timeFrom ? 1 : -1));
}

/** Контакты гостя для карточки брони в боте (телефон/юзернейм из профиля). */
export async function getGuestContact(guestId) {
  if (!guestId) return null;
  const { data } = await supabase.from('users')
    .select('phone, telegram_id, telegram_username').eq('id', guestId).maybeSingle();
  if (!data) return null;
  return {
    phone: data.phone || '',
    telegramId: data.telegram_id || null,
    telegramUsername: data.telegram_username || null,
  };
}
