/**
 * План зала v2 — геометрия из design/plan-v2.svg (CorelDRAW-экспорт владельца,
 * холст 30000×30000). Позиции статичны и правятся ТОЛЬКО здесь (drag&drop-
 * редактор из админки убран по решению владельца).
 *
 * Внутренние id столов (T1…T7, B1, B2) — исторические, их знают БД и брони,
 * переименовывать нельзя. Гость и бармен видят ЗОННУЮ нумерацию (решение
 * владельца, 2026-07-04): «Основной зал №1–3», «У окна №1–4» (нижний ряд,
 * слева направо), «Диван №1–2». Никаких «лаунжей».
 *
 * ⚠️ ЧИСЛО МЕСТ — ПРИКИДКА ПО РАЗМЕРУ СТОЛА. Владелец: активные места
 * правятся в админке (вкладка СТОЛЫ), состав seats — здесь.
 *
 * Барная стойка НЕ бронируется — рисуется в FloorPlanSvg как акцент.
 */

const seat = (angle) => ({ angle, active: true });
const seats = (...angles) => angles.map(seat);

/** @type {import('./types').TableConfig[]} */
export const TABLES = [
  // ── Основной зал (центр) ──
  {
    id: 'T7', num: 1, zone: 'Основной зал', zoneShort: 'Зал', type: 'square',
    x: 10202, y: 9292, w: 4800, h: 4800,
    depositPrice: 0,
    seats: seats(0, 90, 180, 270, 45, 315),
  },
  {
    id: 'T1', num: 2, zone: 'Основной зал', zoneShort: 'Зал', type: 'round',
    cx: 12033, cy: 18602, radius: 2400,
    depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  {
    id: 'T2', num: 3, zone: 'Основной зал', zoneShort: 'Зал', type: 'round',
    cx: 19475, cy: 18564, radius: 2400,
    depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  // ── У окна (нижний ряд, нумерация слева направо) ──
  {
    id: 'T3', num: 1, zone: 'У окна', zoneShort: 'Окно', type: 'round',
    cx: 3603, cy: 27488, radius: 2400,
    depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  {
    id: 'T4', num: 2, zone: 'У окна', zoneShort: 'Окно', type: 'round',
    cx: 10096, cy: 27450, radius: 2400,
    depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  {
    id: 'T5', num: 3, zone: 'У окна', zoneShort: 'Окно', type: 'round',
    cx: 19551, cy: 27450, radius: 2400,
    depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  {
    id: 'T6', num: 4, zone: 'У окна', zoneShort: 'Окно', type: 'round',
    cx: 25930, cy: 27526, radius: 2400,
    depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  // ── Диваны (прямоугольные, у левой стены; банкетки рядом — декор) ──
  {
    id: 'B1', num: 1, zone: 'Диваны', zoneShort: 'Диван', type: 'booth',
    x: 1792, y: 6856, w: 3764, h: 8023,
    depositPrice: 0,
    seats: seats(0, 60, 120, 180, 240, 300),
  },
  {
    id: 'B2', num: 2, zone: 'Диваны', zoneShort: 'Диван', type: 'booth',
    x: 1825, y: 15638, w: 3764, h: 8023,
    depositPrice: 0,
    seats: seats(0, 60, 120, 180, 240, 300),
  },
];

/** Подписи зон на плане (координаты — мировые единицы плана) */
export const ZONE_LABELS = [
  { key: 'zoneMain', x: 15400, y: 22900, ru: 'ОСНОВНОЙ ЗАЛ' },
  { key: 'zoneWindow', x: 14600, y: 24900, ru: 'У ОКНА' },
  { key: 'zoneSofas', x: 3674, y: 6100, ru: 'ДИВАНЫ' },
];

/** ViewBox исходного холста плана (для справки; рендер режет по контенту) */
export const PLAN_W = 30000;
export const PLAN_H = 30000;

/** Барных стульев в брони больше нет; константы оставлены для совместимости. */
export const BAR_STOOL_W = 1148;
export const BAR_STOOL_H = 1023;

/** Returns the number of active (placed) seats for a table */
export function activeSeats(table) {
  return table.seats.filter(s => s.active).length;
}
