/**
 * План зала v2 — геометрия из design/plan-v2.svg (CorelDRAW-экспорт владельца,
 * viewBox "0 0 30000 30000"). Старый программный план и координаты под него
 * заменены целиком (HANDOFF_BOOKING_V2.md §4).
 *
 * Внутренние id столов (T1…T7, B1, B2) сохранены со старого плана — их знают
 * БД и история броней, переименовывать нельзя. Гость id не видит: в гостевом
 * UI показываются номер (num, лёгкая нумерация 1–9 на плане) и человеческое
 * описание («Круглый стол №3 · Основной зал · 4 места»).
 *
 * ⚠️ ЧИСЛО МЕСТ — ПРИКИДКА ПО РАЗМЕРУ СТОЛА (круглые r=2400 ≈ 4, квадрат ≈ 6,
 * диваны ≈ 6). Владелец: чтобы поправить, добавьте/уберите записи в seats
 * нужного стола — больше ничего менять не нужно.
 *
 * Барная стойка НЕ бронируется (решение владельца) — барных стульев BAR1–7
 * больше нет в конфиге. Стойка рисуется в FloorPlanSvg как светящийся акцент
 * с подписью «не бронируется — просто приходите».
 */

const seat = (angle) => ({ angle, active: true });
const seats = (...angles) => angles.map(seat);

/** @type {import('./types').TableConfig[]} */
export const TABLES = [
  // Квадратный стол в центре верхней части зала
  {
    id: 'T7', num: 1, type: 'square',
    x: 10202, y: 9292, w: 4800, h: 4800,
    zone: 'Основной зал', depositPrice: 0,
    seats: seats(0, 90, 180, 270, 45, 315),
  },
  // Круглые столы (r = 2400)
  {
    id: 'T1', num: 2, type: 'round',
    cx: 12033, cy: 18602, radius: 2400,
    zone: 'Основной зал', depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  {
    id: 'T2', num: 3, type: 'round',
    cx: 19475, cy: 18564, radius: 2400,
    zone: 'Основной зал', depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  {
    id: 'T3', num: 4, type: 'round',
    cx: 3603, cy: 27488, radius: 2400,
    zone: 'Основной зал', depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  {
    id: 'T4', num: 5, type: 'round',
    cx: 10096, cy: 27450, radius: 2400,
    zone: 'Основной зал', depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  {
    id: 'T5', num: 6, type: 'round',
    cx: 19551, cy: 27450, radius: 2400,
    zone: 'Основной зал', depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  {
    id: 'T6', num: 7, type: 'round',
    cx: 25930, cy: 27526, radius: 2400,
    zone: 'Основной зал', depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  // Диваны-боксы у левой стены (лаунж). Приставные места (узкие банкетки и
  // пуфы слева от диванов) — часть лаунж-зоны, отдельно не бронируются и
  // рисуются декором в FloorPlanSvg.
  {
    id: 'B1', num: 8, type: 'booth',
    x: 1792, y: 6856, w: 3764, h: 8023,
    zone: 'Лаунж', depositPrice: 0,
    seats: seats(0, 60, 120, 180, 240, 300),
  },
  {
    id: 'B2', num: 9, type: 'booth',
    x: 1825, y: 15638, w: 3764, h: 8023,
    zone: 'Лаунж', depositPrice: 0,
    seats: seats(0, 60, 120, 180, 240, 300),
  },
];

/** ViewBox плана v2 — общий для FloorPlanSvg и редактора в админке. */
export const PLAN_W = 30000;
export const PLAN_H = 30000;

/** Барных стульев в брони больше нет; константы оставлены, чтобы не ломать
 *  импорты редактора плана в админке (там ветка type==='bar' стала мёртвой). */
export const BAR_STOOL_W = 1148;
export const BAR_STOOL_H = 1023;

/** Returns the number of active (placed) seats for a table */
export function activeSeats(table) {
  return table.seats.filter(s => s.active).length;
}
