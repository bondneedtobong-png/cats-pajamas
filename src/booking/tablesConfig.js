/**
 * Static floor plan configuration.
 * Coordinates match the plan-test.svg viewBox="0 0 29700 21000".
 *
 * Seats array follows the schema from iteration 6 — angle-based slots around
 * round/square tables, position-based for booths. Using it here means the
 * floor plan editor (iteration 6) won't require a data migration.
 *
 * seats[i].active = false means the chair slot exists but is currently disabled
 * (e.g. a chair was removed). activeSeats() counts only active: true.
 */

/** @type {import('./types').TableConfig[]} */
export const TABLES = [
  {
    id: 'T1', type: 'round',
    cx: 3000, cy: 19200, radius: 1500,
    zone: 'Основной зал', depositPrice: 0,
    seats: [
      { angle: 0,   active: true },
      { angle: 90,  active: true },
      { angle: 180, active: true },
      { angle: 270, active: true },
    ],
  },
  {
    id: 'T2', type: 'round',
    cx: 8400, cy: 13800, radius: 1500,
    zone: 'Основной зал', depositPrice: 0,
    seats: [
      { angle: 0,   active: true },
      { angle: 90,  active: true },
      { angle: 180, active: true },
      { angle: 270, active: true },
    ],
  },
  {
    id: 'T3', type: 'round',
    cx: 8400, cy: 19200, radius: 1500,
    zone: 'Основной зал', depositPrice: 0,
    seats: [
      { angle: 0,   active: true },
      { angle: 90,  active: true },
      { angle: 180, active: true },
      { angle: 270, active: true },
    ],
  },
  {
    id: 'T4', type: 'round',
    cx: 22200, cy: 12600, radius: 1500,
    zone: 'VIP', depositPrice: 0,
    seats: [
      { angle: 0,   active: true },
      { angle: 90,  active: true },
      { angle: 180, active: true },
      { angle: 270, active: true },
    ],
  },
  {
    id: 'T5', type: 'round',
    cx: 21600, cy: 19200, radius: 1500,
    zone: 'VIP', depositPrice: 0,
    seats: [
      { angle: 0,   active: true },
      { angle: 90,  active: true },
      { angle: 180, active: true },
      { angle: 270, active: true },
    ],
  },
  {
    id: 'T6', type: 'round',
    cx: 27000, cy: 19200, radius: 1500,
    zone: 'VIP', depositPrice: 0,
    seats: [
      { angle: 0,   active: true },
      { angle: 90,  active: true },
      { angle: 180, active: true },
      { angle: 270, active: true },
    ],
  },
  {
    id: 'T7', type: 'square',
    x: 6600, y: 6600, w: 2700, h: 2700,
    zone: 'Основной зал', depositPrice: 0,
    seats: [
      { angle: 0,   active: true },
      { angle: 90,  active: true },
      { angle: 180, active: true },
      { angle: 270, active: true },
      { angle: 45,  active: true },
      { angle: 315, active: true },
    ],
  },
  {
    id: 'B1', type: 'booth',
    x: 1200, y: 10800, w: 1952, h: 4409,
    zone: 'Диваны', depositPrice: 0,
    seats: [
      { angle: 0,   active: true },
      { angle: 60,  active: true },
      { angle: 120, active: true },
      { angle: 180, active: true },
      { angle: 240, active: true },
      { angle: 300, active: true },
    ],
  },
  {
    id: 'B2', type: 'booth',
    x: 1200, y: 4200, w: 2050, h: 3946,
    zone: 'Диваны', depositPrice: 0,
    seats: [
      { angle: 0,   active: true },
      { angle: 60,  active: true },
      { angle: 120, active: true },
      { angle: 180, active: true },
      { angle: 240, active: true },
      { angle: 300, active: true },
    ],
  },

  // Bar stools — each is an independently bookable single-seat "table".
  // bx/by are the stool's top-left in SVG world coords (size BAR_STOOL_W/H).
  // Ordered left → right along the counter.
  { id: 'BAR1', type: 'bar', bx: 9000,  by: 4200, zone: 'Бар', depositPrice: 0, seats: [{ angle: 0, active: true }] },
  { id: 'BAR2', type: 'bar', bx: 10800, by: 4200, zone: 'Бар', depositPrice: 0, seats: [{ angle: 0, active: true }] },
  { id: 'BAR3', type: 'bar', bx: 12600, by: 4200, zone: 'Бар', depositPrice: 0, seats: [{ angle: 0, active: true }] },
  { id: 'BAR4', type: 'bar', bx: 15000, by: 4200, zone: 'Бар', depositPrice: 0, seats: [{ angle: 0, active: true }] },
  { id: 'BAR5', type: 'bar', bx: 16800, by: 4200, zone: 'Бар', depositPrice: 0, seats: [{ angle: 0, active: true }] },
  { id: 'BAR6', type: 'bar', bx: 19200, by: 4200, zone: 'Бар', depositPrice: 0, seats: [{ angle: 0, active: true }] },
  { id: 'BAR7', type: 'bar', bx: 21000, by: 4200, zone: 'Бар', depositPrice: 0, seats: [{ angle: 0, active: true }] },
];

/** Bar stool render size (SVG world units), shared by floor plan + editor. */
export const BAR_STOOL_W = 1148;
export const BAR_STOOL_H = 1023;

/** Returns the number of active (placed) seats for a table */
export function activeSeats(table) {
  return table.seats.filter(s => s.active).length;
}
