import sharp from 'sharp';
import { TABLES, ZONE_LABELS, WINDOWS, BAR_GEO, PLAN_VB, activeSeats } from '../../src/booking/tablesConfig.js';
import { CHAIR, chairsFor, boothParts } from '../../src/booking/furniture.js';

// Серверный рендер плана зала в PNG с выделенным столом — прикладывается к
// заявке в стафф-группе и к «Бронь подтверждена» гостю, чтобы стол было видно
// глазами, а не только текстом. SVG собирается строкой из ТОЙ ЖЕ геометрии
// tablesConfig и мебели furniture.js (раскладка совпадает с сайтом, план v4),
// растеризует sharp (librsvg). Шрифт — системный sans-serif: на VPS брендовых
// шрифтов нет, для схемы это ок. Мебель нарочно упрощена (без спинок стульев),
// но раскладка столов идентична сайту.
//
// Всё best-effort: любой сбой рендера не должен ронять создание/подтверждение
// брони — вызывающие стороны обязаны оборачивать в try/catch. librsvg НЕ
// поддерживает color-mix — только явные rgba().

const VB = PLAN_VB; // общий с FloorPlanSvg.jsx
const OUT_W = 1000;

const C = {
  bg0: '#241019', bg1: '#150a13',
  line: 'rgba(198,191,181,0.24)',
  chair: 'rgba(198,191,181,0.22)',
  tableFill: 'rgba(198,191,181,0.05)',
  tableStroke: 'rgba(198,191,181,0.34)',
  rim: 'rgba(198,191,181,0.20)',
  num: 'rgba(198,191,181,0.55)',
  gold: '#C79A2E',
  goldDim: 'rgba(199,154,46,0.45)',
  goldFill: 'rgba(199,154,46,0.16)',
  goldRim: 'rgba(199,154,46,0.6)',
};

const BAR = BAR_GEO;

// Упрощённый стул: одно скруглённое сиденье (без спинки) — в PNG мелко, спинка
// сливается. Раскладка та же (furniture.js). Диван — спинка + подлокотники.
function furnitureSvg(t) {
  if (t.type === 'booth') {
    const b = boothParts(t.x, t.y, t.w, t.h);
    let s = `<g fill="none" stroke="${C.chair}" stroke-width="70" stroke-linejoin="round">`;
    s += `<rect x="${b.back.x}" y="${b.back.y}" width="${b.back.w}" height="${b.back.h}" rx="${b.back.r}"/>`;
    for (const a of b.arms) s += `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="${a.r}"/>`;
    return s + `</g>`;
  }
  let s = `<g fill="none" stroke="${C.chair}" stroke-width="70" stroke-linejoin="round">`;
  for (const ch of chairsFor(t)) {
    s += `<g transform="translate(${ch.x.toFixed(0)},${ch.y.toFixed(0)}) rotate(${ch.rot.toFixed(1)})">`
      + `<rect x="${-CHAIR.seatW / 2}" y="${-CHAIR.seatH / 2 + 120}" width="${CHAIR.seatW}" height="${CHAIR.seatH}" rx="${CHAIR.seatR}"/></g>`;
  }
  return s + `</g>`;
}

function tableShapeSvg(t, highlighted) {
  const stroke = highlighted ? C.gold : C.tableStroke;
  const fill = highlighted ? C.goldFill : C.tableFill;
  const rim = highlighted ? C.goldRim : C.rim;
  const sw = highlighted ? 150 : 78;
  if (t.type === 'round') {
    const ring = highlighted
      ? `<circle cx="${t.cx}" cy="${t.cy}" r="${t.radius + 520}" fill="none" stroke="${C.goldDim}" stroke-width="80"/>`
      : '';
    return `${ring}<circle cx="${t.cx}" cy="${t.cy}" r="${t.radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
      + `<circle cx="${t.cx}" cy="${t.cy}" r="${t.radius - 230}" fill="none" stroke="${rim}" stroke-width="30"/>`;
  }
  if (t.type === 'booth') {
    const b = boothParts(t.x, t.y, t.w, t.h);
    const ring = highlighted
      ? `<rect x="${b.seat.x - 460}" y="${b.seat.y - 460}" width="${b.seat.w + 920}" height="${b.seat.h + 920}" rx="440" fill="none" stroke="${C.goldDim}" stroke-width="80"/>`
      : '';
    let seams = `<g stroke="${highlighted ? C.goldRim : C.rim}" stroke-width="30">`;
    for (const s of b.seams) seams += `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}"/>`;
    seams += `</g>`;
    return `${ring}<rect x="${b.seat.x}" y="${b.seat.y}" width="${b.seat.w}" height="${b.seat.h}" rx="${b.seat.r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>${seams}`;
  }
  const ring = highlighted
    ? `<rect x="${t.x - 520}" y="${t.y - 520}" width="${t.w + 1040}" height="${t.h + 1040}" rx="440" fill="none" stroke="${C.goldDim}" stroke-width="80"/>`
    : '';
  return `${ring}<rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="240" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
    + `<rect x="${t.x + 230}" y="${t.y + 230}" width="${t.w - 460}" height="${t.h - 460}" rx="150" fill="none" stroke="${rim}" stroke-width="30"/>`;
}

function tableCenter(t) {
  if (t.type === 'round') return [t.cx, t.cy];
  if (t.type === 'booth') { const b = boothParts(t.x, t.y, t.w, t.h); return [b.seat.x + b.seat.w / 2, b.seat.y + b.seat.h / 2]; }
  return [t.x + t.w / 2, t.y + t.h / 2];
}

/**
 * PNG плана с выделенным столом. Возвращает Buffer.
 * @param {string} highlightTableId — внутренний id стола (T1…B2)
 */
export async function renderPlanPng(highlightTableId) {
  const parts = [];
  parts.push('<defs>'
    + `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bg0}"/><stop offset="1" stop-color="${C.bg1}"/></linearGradient>`
    + `<radialGradient id="vig" cx="50%" cy="42%" r="72%"><stop offset="0%" stop-color="#000" stop-opacity="0"/><stop offset="78%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.32"/></radialGradient>`
    + '</defs>');
  parts.push(`<rect x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" fill="url(#bg)"/>`);
  parts.push(`<rect x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" fill="url(#vig)"/>`);
  // стойка
  parts.push(`<rect x="${BAR.x}" y="${BAR.y}" width="${BAR.w}" height="${BAR.h}" rx="${BAR.rx}" fill="rgba(199,154,46,0.06)" stroke="${C.goldDim}" stroke-width="60"/>`);
  parts.push(`<text x="${BAR.x + BAR.w / 2}" y="${BAR.y + 2050}" text-anchor="middle" font-family="sans-serif" font-size="1050" letter-spacing="300" fill="${C.goldDim}">BAR</text>`);
  // окна + вход
  for (const w of WINDOWS) {
    parts.push(`<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="90" fill="none" stroke="${C.line}" stroke-width="50"/>`);
  }
  const entX = (WINDOWS[0].x + WINDOWS[0].w + WINDOWS[1].x) / 2;
  parts.push(`<text x="${entX}" y="${WINDOWS[0].y + 200}" text-anchor="middle" font-family="sans-serif" font-size="470" letter-spacing="160" fill="${C.line}">ВХОД</text>`);
  // подписи зон — нумерация столов зонная («Основной зал №1», «У окна №2»…)
  for (const z of ZONE_LABELS) {
    parts.push(`<text x="${z.x}" y="${z.y}" text-anchor="middle" font-family="sans-serif" font-size="560" letter-spacing="220" fill="${C.num}">${z.ru}</text>`);
  }
  // мебель под всеми столами
  for (const t of TABLES) { if (t.type !== 'bar') parts.push(furnitureSvg(t)); }
  // столы: сперва обычные, выделенный — поверх
  const sorted = [...TABLES].sort((a, b) => (a.id === highlightTableId) - (b.id === highlightTableId));
  for (const t of sorted) {
    if (t.type === 'bar') continue;
    const hi = t.id === highlightTableId;
    parts.push(tableShapeSvg(t, hi));
    const [cx, cy] = tableCenter(t);
    parts.push(
      `<text x="${cx}" y="${cy + 330}" text-anchor="middle" font-family="sans-serif" font-weight="bold" `
      + `font-size="${hi ? 1150 : 780}" fill="${hi ? C.gold : C.num}">№${t.num ?? ''}</text>`,
    );
  }

  const outH = Math.round(OUT_W * (VB.h / VB.w));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${outH}" `
    + `viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}">${parts.join('')}</svg>`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

/** Подпись места для caption: сколько мест у стола (для полноты картинки). */
export function tableSeatsCount(tableId) {
  const t = TABLES.find(x => x.id === tableId);
  return t ? activeSeats(t) : null;
}
