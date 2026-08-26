import { supabase } from './supabase.js';

// Тестовый прогон афиши (кнопка «🧪 Тестовый прогон» в разделе «События» бота).
//
// Зачем: перед настоящей публикацией владелец хочет посмотреть, как событие
// выглядит в канале и на сайте, и убедиться, что рассылка нашла бы всех, кого
// надо — но БЕЗ спама гостям. Поэтому прогон:
//   • публикует пост в канале и заводит событие на сайте;
//   • рассылку не делает вовсе, а считает аудиторию (broadcastAudit) и
//     пересылает пост только администраторам — это честная проверка того же
//     forwardMessage, которым идёт настоящая рассылка;
//   • через TEST_TTL_MS сам всё убирает: пост из канала и событие из БД.
//
// Уборка идемпотентна: и таймер, и кнопка «Удалить сейчас» зовут одну функцию,
// повторный вызов ничего не ломает.

export const TEST_TTL_MS = 30_000;

/**
 * Кому ушла бы рассылка — без единой отправки.
 * bot_blocked ставит broadcast.js, когда гость заблокировал бота (403).
 */
export async function broadcastAudit() {
  const { data, error } = await supabase.from('users').select('id, telegram_id, bot_blocked, phone');
  if (error) throw new Error(error.message);
  const rows = data || [];
  const withTg = rows.filter((u) => u.telegram_id);
  const blocked = withTg.filter((u) => u.bot_blocked);
  return {
    accounts: rows.length,                       // всего аккаунтов (сайт + бот)
    withTelegram: withTg.length,                 // из них связаны с телеграмом
    blocked: blocked.length,                     // заблокировали бота — им не пишем
    reachable: withTg.length - blocked.length,   // реально получили бы пост
    siteOnly: rows.length - withTg.length,       // регистрировались на сайте без телеграма
  };
}

/** Реестр незавершённых прогонов: id события → что за собой убрать. */
const pending = new Map();

export function registerTestRun(state) {
  pending.set(state.eventId, state);
  return state;
}
export function getTestRun(eventId) {
  return pending.get(eventId) || null;
}
export function forgetTestRun(eventId) {
  pending.delete(eventId);
}
export const pendingCount = () => pending.size;
