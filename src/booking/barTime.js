/**
 * Единые время-хелперы бронирования — часовой пояс бара (Самара, UTC+4,
 * сезонного перевода часов в России нет). Сервер (VPS/Vercel) живёт в UTC,
 * поэтому naive `new Date(`${date}T${time}:00`)` смещал бы все сравнения на
 * 4 часа. Всё, что сравнивает время прихода с «сейчас», определяет «текущий
 * вечер» или строит слоты времени — обязано идти через этот модуль.
 * Импортируется и фронтом, и api/_lib (как tablesConfig.js).
 */

export const BAR_UTC_OFFSET_MIN = 4 * 60; // Самара = UTC+4

// Бар работает за полночь (до 02:00/04:00): бронь «на 01:00» относится к вечеру
// ПРЕДЫДУЩЕЙ календарной даты. reservations.date — это дата ВЕЧЕРА, не дата
// прихода. Всё, что раньше этого порога, трактуем как «после полуночи того же
// вечера» (реальный приход — следующая календарная дата).
export const NIGHT_CUTOFF_MIN = 6 * 60; // 06:00

// Часы работы (синхронно со Schema.org в index.html): пн–чт и вс 17:00–02:00,
// пт–сб 16:00–04:00. Ключ — день недели ДАТЫ ВЕЧЕРА (0=вс … 6=сб);
// closeMin > 24:00 означает «за полночь».
export const WORKING_HOURS = {
  0: { openMin: 17 * 60, closeMin: 26 * 60 }, // вс
  1: { openMin: 17 * 60, closeMin: 26 * 60 }, // пн
  2: { openMin: 17 * 60, closeMin: 26 * 60 }, // вт
  3: { openMin: 17 * 60, closeMin: 26 * 60 }, // ср
  4: { openMin: 17 * 60, closeMin: 26 * 60 }, // чт
  5: { openMin: 16 * 60, closeMin: 28 * 60 }, // пт
  6: { openMin: 16 * 60, closeMin: 28 * 60 }, // сб
};

export function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minToTime(m) {
  return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

function pad(n) { return String(n).padStart(2, '0'); }
function isoDateOf(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** «Сейчас» в координатах бара: календарная дата + минуты от полуночи. */
export function barNow(now = new Date()) {
  const shifted = new Date(now.getTime() + BAR_UTC_OFFSET_MIN * 60000);
  return {
    date: isoDateOf(shifted),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** Дата «текущего вечера»: до NIGHT_CUTOFF утра это ещё вчерашний вечер. */
export function barEveningDate(now = new Date()) {
  const shifted = new Date(now.getTime() + (BAR_UTC_OFFSET_MIN - NIGHT_CUTOFF_MIN) * 60000);
  return isoDateOf(shifted);
}

/**
 * Реальный момент прихода по (дата вечера, 'HH:MM') → Date (UTC).
 * Ночные слоты (раньше NIGHT_CUTOFF) — уже следующая календарная дата.
 */
export function reservationInstant(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const min = timeToMin(time);
  const dayShift = min < NIGHT_CUTOFF_MIN ? 1 : 0;
  return new Date(Date.UTC(y, m - 1, d + dayShift, 0, min - BAR_UTC_OFFSET_MIN));
}

export const SLOT_STEP_MIN = 30;
export const LAST_SLOT_BEFORE_CLOSE_MIN = 60; // последний слот — за час до закрытия
export const PAST_SLOT_GRACE_MIN = 15;        // «к 20:00» можно выбрать до 20:15 — гость уже в пути

/**
 * Слоты времени прихода для формы/бота на дату вечера: от открытия до часа
 * перед закрытием, шаг 30 мин, включая после-полуночные ('01:00' и т.п.).
 * Для текущего вечера прошедшие слоты отрезаются (с 15-минутным грейсом).
 */
export function buildTimeSlots(eveningDate, now = new Date()) {
  const dow = new Date(`${eveningDate}T12:00:00Z`).getUTCDay();
  const { openMin, closeMin } = WORKING_HOURS[dow];
  const out = [];
  for (let m = openMin; m <= closeMin - LAST_SLOT_BEFORE_CLOSE_MIN; m += SLOT_STEP_MIN) {
    out.push(minToTime(m));
  }
  if (eveningDate !== barEveningDate(now)) return out;
  const cutoff = now.getTime() - PAST_SLOT_GRACE_MIN * 60000;
  return out.filter(t => reservationInstant(eveningDate, t).getTime() >= cutoff);
}

/** Ближайшие n дат вечеров, начиная с текущего вечера (для выбора даты). */
export function upcomingEveningDates(n, now = new Date()) {
  const first = barEveningDate(now);
  const [y, m, d] = first.split('-').map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(isoDateOf(new Date(Date.UTC(y, m - 1, d + i))));
  }
  return out;
}
