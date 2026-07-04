import { supabase } from './supabase.js';

// Уровни гостя (введены 2026-07-04, заменили баллы/колесо дня/каталог наград).
// Уровень считается от числа ПОДТВЕРЖДЁННЫХ броней гостя: заявку подтвердил
// бармен, и она не сорвалась (отменённые и неявки не в счёт). Регистрация даёт
// 1-й уровень. Никакого отдельного счётчика в БД — уровень всегда вычисляется
// из reservations, поэтому не бывает двойных начислений и рассинхрона.
// Админ может выставить уровень вручную (users.level_override) — ручное
// значение важнее вычисленного, «авто» возвращается сбросом override в null.
// Старые таблицы (wheel_spins, loyalty_*) остаются в БД как история — код к
// ним больше не обращается.

export const CONFIRMED_STATUSES = ['confirmed', 'seated', 'completed'];

export const LEVELS = [
  { num: 1, key: 'champagne', label: 'Шампанское', emoji: '🍾', minBookings: 0 },
  { num: 2, key: 'wine',      label: 'Вино',       emoji: '🍷', minBookings: 1 },
  { num: 3, key: 'vermouth',  label: 'Вермут',     emoji: '🫒', minBookings: 3 },
  { num: 4, key: 'gin',       label: 'Джин',       emoji: '🍸', minBookings: 5 },
  { num: 5, key: 'rum',       label: 'Ром',        emoji: '🍹', minBookings: 10 },
  { num: 6, key: 'tequila',   label: 'Текила',     emoji: '🌵', minBookings: 15 },
  { num: 7, key: 'whiskey',   label: 'Виски',      emoji: '🥃', minBookings: 20 },
  { num: 8, key: 'cognac',    label: 'Коньяк',     emoji: '👑', minBookings: 25 },
  { num: 9, key: 'absinthe',  label: 'Абсент',     emoji: '🧚', minBookings: 50 },
];

export function levelForBookings(count) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (count >= l.minBookings) cur = l;
  return cur;
}

export function levelByNum(num) {
  return LEVELS.find(l => l.num === Number(num)) || null;
}

export function nextLevelFor(count) {
  return LEVELS.find(l => l.minBookings > count) || null;
}

export async function countConfirmedBookings(guestId) {
  const { data, error } = await supabase.from('reservations')
    .select('id').eq('guest_id', guestId).in('status', CONFIRMED_STATUSES);
  if (error) throw new Error(error.message);
  return (data || []).length;
}

/** Статус уровня гостя — для сайта (вкладка «Уровень») и бота («Мой уровень»).
 *  next.remaining — сколько подтверждённых броней осталось до следующего уровня
 *  (по вычисленной лестнице; при ручном override прогресс всё равно считается
 *  от реальных броней — админская правка не «замораживает» рост). */
export async function getGuestLevel(guestId) {
  const { data: user, error } = await supabase.from('users')
    .select('id, level_override').eq('id', guestId).maybeSingle();
  if (error || !user) throw new Error('Пользователь не найден');
  const bookings = await countConfirmedBookings(guestId);
  const auto = levelForBookings(bookings);
  const override = user.level_override ? levelByNum(user.level_override) : null;
  const level = (override && override.num > auto.num) ? override : auto;
  const next = nextLevelFor(bookings);
  return {
    level,
    bookings,
    overridden: !!override,
    next: next && next.num > level.num
      ? { num: next.num, label: next.label, emoji: next.emoji, minBookings: next.minBookings, remaining: next.minBookings - bookings }
      : null,
  };
}
