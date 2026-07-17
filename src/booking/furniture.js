/**
 * Мебельная геометрия плана зала (v4) — «стол выглядит мебелью, а не схемой».
 * Чистые функции в МИРОВЫХ единицах (30000-канвас tablesConfig): считают
 * позиции стульев вокруг стола и раскладку дивана. Framework-agnostic —
 * их потребляют ОБА рендерера: FloorPlanSvg.jsx (React, экран) и
 * planImage.js (строковый SVG → PNG для Telegram, упрощённый набор).
 *
 * Стул «сверху» = сиденье (скруглённый квадрат) + спинка (полоска на внешней
 * стороне). Канонический стул смотрит ВНИЗ (+y = к центру, если стул сверху),
 * поэтому спинка сверху; при размещении вращаем на угол `rot`, чтобы стул
 * «смотрел» на стол. Всё статично — ни одной анимации (правило .fp-svg).
 */
import { activeSeats, PLAN_ROOM } from './tablesConfig.js';

// Габариты стула в мировых единицах. Тонкий контур — «намёк на посадку»,
// не фотореализм (стойка ~2200 радиус → стул заметно меньше стола).
export const CHAIR = {
  seatW: 980, seatH: 900, seatR: 300,   // сиденье
  backW: 1160, backH: 300, backR: 150,  // спинка (шире сиденья, тоньше)
  gap: 300,                             // зазор между краем стола и стулом
};
// Насколько канонический стул выступает «к столу» от своего центра (низ сиденья)
const CHAIR_REACH = CHAIR.seatH / 2 + 300; // seat уходит вниз от центра

const rad = (deg) => (deg * Math.PI) / 180;

/** Стулья вокруг круглого стола: n штук равномерно, стартуя сверху по часовой. */
export function roundChairs(cx, cy, radius, n) {
  if (!n || n < 1) return [];
  const R = radius + CHAIR.gap + CHAIR_REACH;
  const out = [];
  for (let i = 0; i < n; i++) {
    const phi = -90 + (360 * i) / n; // 0=восток, -90=север (старт сверху)
    out.push({
      x: cx + R * Math.cos(rad(phi)),
      y: cy + R * Math.sin(rad(phi)),
      rot: phi + 90, // канонический стул смотрит +y; довернуть к центру
    });
  }
  return out;
}

/** Распределить n стульев по 4 сторонам прямоугольника (столы «квадрат»). */
export function rectChairs(x, y, w, h, n) {
  if (!n || n < 1) return [];
  // Порядок сторон по «вместимости»: длинные стороны берут больше стульев.
  const sides = [
    { key: 'top',    len: w, normal: 270 },
    { key: 'bottom', len: w, normal: 90 },
    { key: 'right',  len: h, normal: 0 },
    { key: 'left',   len: h, normal: 180 },
  ];
  // сколько стульев на сторону: раздаём по кругу, начиная с более длинных
  const order = [...sides].sort((a, b) => b.len - a.len);
  const perSide = new Map(sides.map((s) => [s.key, 0]));
  for (let i = 0; i < n; i++) perSide.set(order[i % 4].key, perSide.get(order[i % 4].key) + 1);

  const cx = x + w / 2, cy = y + h / 2;
  const offset = CHAIR.gap + CHAIR_REACH;
  const out = [];
  for (const s of sides) {
    const k = perSide.get(s.key);
    if (!k) continue;
    for (let j = 0; j < k; j++) {
      const t = (j + 1) / (k + 1); // равномерно вдоль стороны
      let px, py;
      if (s.key === 'top')    { px = x + w * t; py = y - offset; }
      if (s.key === 'bottom') { px = x + w * t; py = y + h + offset; }
      if (s.key === 'left')   { px = x - offset; py = y + h * t; }
      if (s.key === 'right')  { px = x + w + offset; py = y + h * t; }
      out.push({ x: px, y: py, rot: s.normal + 90 });
    }
    void cx; void cy;
  }
  return out;
}

/**
 * Раскладка дивана (booth) вдоль ЛЕВОЙ стены: спинка у стены (слева),
 * подлокотники сверху/снизу, широкое сиденье с 2 швами (3 подушки). Столика
 * нет — чистый силуэт «диван». Возвращает примитивы (мировые единицы):
 * `back`/`arms`/`seams` — обивка (декор), `seat` — кликабельная форма статуса.
 */
export function boothParts(x, y, w, h) {
  const inset = 140;
  const backW = Math.round(w * 0.30);           // спинка у стены
  const armH = Math.round(h * 0.12);            // подлокотники
  const seatX = x + backW;
  const seatRight = x + w - inset;
  const seatTop = y + inset + armH;
  const seatBot = y + h - inset - armH;
  const seatH = seatBot - seatTop;
  const seams = [seatTop + seatH / 3, seatTop + (2 * seatH) / 3]; // 2 шва → 3 подушки
  return {
    back: { x: x + inset, y: y + inset, w: backW - inset, h: h - 2 * inset, r: 260 },
    arms: [
      { x: seatX, y: y + inset, w: seatRight - seatX, h: armH, r: 180 },
      { x: seatX, y: y + h - inset - armH, w: seatRight - seatX, h: armH, r: 180 },
    ],
    seat: { x: seatX, y: seatTop, w: seatRight - seatX, h: seatH, r: 220 },
    seams: seams.map((sy) => ({ x1: seatX + 160, y1: sy, x2: seatRight - 160, y2: sy })),
  };
}

/** Стул внутри «комнаты»? (центр не за стеной/окном). */
function inRoom({ x, y }) {
  return x >= PLAN_ROOM.x0 && x <= PLAN_ROOM.x1 && y >= PLAN_ROOM.y0 && y <= PLAN_ROOM.y1;
}

/** Единый вход: для стола вернуть список стульев (круг/квадрат), отбросив те,
 *  что вышли за пределы комнаты. Диван — отдельно (boothParts). */
export function chairsFor(table) {
  const n = activeSeats(table);
  let chairs = [];
  if (table.type === 'round') chairs = roundChairs(table.cx, table.cy, table.radius || 2200, n);
  else if (table.type === 'square') chairs = rectChairs(table.x, table.y, table.w, table.h, n);
  return chairs.filter(inRoom);
}
