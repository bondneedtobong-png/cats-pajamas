/**
 * План зала v3 — компоновка по реальной планировке зала (стрелки владельца,
 * 2026-07-04): стойка сверху по центру, два дивана у ЛЕВОЙ стены, основной
 * зал в центре (квадратный + круглый, ещё один круглый правее), два ОКНА по
 * нижним углам — по паре круглых столов у каждого. Холст ландшафтный
 * (~32000×21900), под пропорции карточки плана на странице.
 *
 * Позиции статичны и правятся ТОЛЬКО здесь (drag&drop-редактор убран).
 * Внутренние id столов (T1…T7, B1, B2) — исторические, их знают БД и брони,
 * переименовывать нельзя. Гость и бармен видят ЗОННУЮ нумерацию:
 * «Основной зал №1–3», «У окна №1–4» (слева направо), «Диван №1–2».
 *
 * ⚠️ ЧИСЛО МЕСТ — ПРИКИДКА. Активные места правятся в админке (СТОЛЫ).
 * Барная стойка НЕ бронируется — рисуется в FloorPlanSvg как акцент.
 */

const seat = (angle) => ({ angle, active: true });
const seats = (...angles) => angles.map(seat);

/** @type {import('./types').TableConfig[]} */
export const TABLES = [
  // ── Основной зал (центр): квадратный + круглый, ещё круглый правее ──
  {
    id: 'T7', num: 1, zone: 'Основной зал', zoneShort: 'Зал', type: 'square',
    x: 8200, y: 9000, w: 4800, h: 4800,
    depositPrice: 0,
    seats: seats(0, 90, 180, 270, 45, 315),
  },
  {
    id: 'T1', num: 2, zone: 'Основной зал', zoneShort: 'Зал', type: 'round',
    cx: 17400, cy: 11400, radius: 2400,
    depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  {
    id: 'T2', num: 3, zone: 'Основной зал', zoneShort: 'Зал', type: 'round',
    cx: 26500, cy: 11400, radius: 2400,
    depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  // ── У окна: два окна по нижним углам, по два стола у каждого ──
  {
    id: 'T3', num: 1, zone: 'У окна', zoneShort: 'Окно', type: 'round',
    cx: 8600, cy: 18400, radius: 2400,
    depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  {
    id: 'T4', num: 2, zone: 'У окна', zoneShort: 'Окно', type: 'round',
    cx: 14400, cy: 18400, radius: 2400,
    depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  {
    id: 'T5', num: 3, zone: 'У окна', zoneShort: 'Окно', type: 'round',
    cx: 22600, cy: 18400, radius: 2400,
    depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  {
    id: 'T6', num: 4, zone: 'У окна', zoneShort: 'Окно', type: 'round',
    cx: 29200, cy: 18400, radius: 2400,
    depositPrice: 0,
    seats: seats(0, 90, 180, 270),
  },
  // ── Диваны (у левой стены, друг над другом) ──
  {
    id: 'B1', num: 1, zone: 'Диваны', zoneShort: 'Диван', type: 'booth',
    x: 1000, y: 4600, w: 4600, h: 5800,
    depositPrice: 0,
    seats: seats(0, 60, 120, 180, 240, 300),
  },
  {
    id: 'B2', num: 2, zone: 'Диваны', zoneShort: 'Диван', type: 'booth',
    x: 1000, y: 11200, w: 4600, h: 5800,
    depositPrice: 0,
    seats: seats(0, 60, 120, 180, 240, 300),
  },
];

/** Подписи зон на плане (координаты — мировые единицы; «У окна» — у обеих групп) */
export const ZONE_LABELS = [
  { key: 'zoneSofas', x: 3300, y: 3900, ru: 'ДИВАНЫ' },
  { key: 'zoneMain', x: 17000, y: 7400, ru: 'ОСНОВНОЙ ЗАЛ' },
  { key: 'zoneWindow', x: 11500, y: 16300, ru: 'У ОКНА' },
  { key: 'zoneWindow', x: 25900, y: 16300, ru: 'У ОКНА' },
];

/** Окна на нижней стене (декор — поясняют зону «У окна») */
export const WINDOWS = [
  { x: 4100, y: 21450, w: 11800, h: 250 },
  { x: 19700, y: 21450, w: 11900, h: 250 },
];

/** Барная стойка (общая геометрия для FloorPlanSvg и planImage) */
export const BAR_GEO = { x: 10500, y: 300, w: 13000, h: 3200, rx: 200 };

/** Декоративная дуга-сцена под стойкой */
export const ARC_D = 'M31800 4000 C 24000 6300, 10000 6300, 1800 4000';

/** ViewBox плана v3 (общий для сайта и PNG в Telegram) */
export const PLAN_VB = { x: 400, y: 0, w: 32000, h: 21900 };

/** Барных стульев в брони больше нет; константы оставлены для совместимости. */
export const BAR_STOOL_W = 1148;
export const BAR_STOOL_H = 1023;

/** Returns the number of active (placed) seats for a table */
export function activeSeats(table) {
  return table.seats.filter(s => s.active).length;
}
