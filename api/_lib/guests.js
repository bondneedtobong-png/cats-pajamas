import { supabase } from './supabase.js';
import { CONFIRMED_STATUSES, LEVELS, levelForBookings, levelByNum } from './loyalty.js';
import { getReservations } from './booking.js';
import { isTelegramAdmin } from './auth.js';

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
    // «Владелец» — telegram_id прописан в .env (TELEGRAM_ADMIN_IDS): супер-админ,
    // его роль тут не меняется (при входе всё равно вернётся admin из env).
    isOwner: isTelegramAdmin(u.telegram_id),
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

/**
 * Смена роли пользователя (Фаза 1 «управление ролями»). Гейт супер-админа
 * (только владельцы из .env) проверяется в HTTP-слое (api/guests.js). Здесь —
 * инварианты: роль из белого списка, нельзя менять свою роль и роль владельца.
 */
export async function setUserRole(actingUserId, targetUserId, role) {
  if (!['admin', 'guest'].includes(role)) throw new Error('Недопустимая роль');
  if (actingUserId === targetUserId) throw new Error('Свою роль здесь менять нельзя');
  const { data: target } = await supabase.from('users')
    .select('id, telegram_id').eq('id', targetUserId).maybeSingle();
  if (!target) throw new Error('Пользователь не найден');
  if (isTelegramAdmin(target.telegram_id)) throw new Error('Владельца (из .env) здесь понизить нельзя');
  const { data, error } = await supabase.from('users')
    .update({ role }).eq('id', targetUserId).select().maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Пользователь не найден');
  return { ok: true, role };
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
