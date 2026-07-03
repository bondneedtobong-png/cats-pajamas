import { getEvents, markEventAttendancePromptSent } from './events.js';
import { getPendingRsvps } from './eventRsvps.js';
import { notifyStaff } from './staffNotify.js';

// Персистентный процесс на VPS (bot-start.js, long polling) — впервые в
// проекте можно держать периодический опрос вместо только request-driven
// логики (раньше бот жил на Vercel serverless, без фонового процесса).
// Обе функции вызываются из setInterval в bot-start.js, каждая best-effort:
// сбой одной брони/события не должен блокировать остальные и не должен
// убивать интервал (ошибки логируются, не пробрасываются наверх).

function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// «Проверка визита» для БРОНЕЙ (бывшая checkPendingBookings) удалена в
// бронировании v2: подтверждение прихода/ухода гостей теперь делает бармен
// через флоу заявок (stok:/stno:) и раздел «Столы сейчас» + автоматика
// seated в time_from (autoSeatDueReservations в booking.js) — иначе бармена
// спрашивали бы дважды. Для СОБЫТИЙ (RSVP) поллер остаётся как был.

export async function checkPendingEventRsvps() {
  const now = new Date();
  const events = await getEvents({ upcomingOnly: false });
  for (const ev of events) {
    if (ev.attendancePromptSentAt) continue;
    const endsAt = new Date(`${ev.date}T${ev.time || '23:59'}:00`);
    if (endsAt > now) continue; // событие ещё не прошло

    try {
      const pending = await getPendingRsvps(ev.id);
      if (!pending.length) continue; // никто не отметился «Я приду» — нечего подтверждать

      const kb = pending.map((rsvp) => ([{
        text: `✅ ${rsvp.guestName}`, callback_data: `evatt:${rsvp.id}`,
      }, {
        text: '❌ не пришёл', callback_data: `evatt_no:${rsvp.id}`,
      }]));
      await notifyStaff(
        `📅 *Подтвердите явку — «${ev.title}»* (${fmtDate(ev.date)})\n\nЗаписалось: ${pending.length}. Отметьте, кто пришёл:`,
        { threadId: process.env.TELEGRAM_STAFF_EVENTS_THREAD_ID, replyMarkup: { inline_keyboard: kb } },
      );
      await markEventAttendancePromptSent(ev.id);
    } catch (e) {
      console.error('[attendancePoller] event', ev.id, 'failed:', e.message);
    }
  }
}
