import sharp from 'sharp';
import { TABLES, ZONE_LABELS, WINDOWS, BAR_GEO, PLAN_VB, activeSeats } from '../../src/booking/tablesConfig.js';

// Серверный рендер плана зала в PNG с выделенным столом — прикладывается к
// заявке в стафф-группе и к «Бронь подтверждена» гостю, чтобы стол было видно
// глазами, а не только текстом. SVG собирается строкой из той же геометрии
// tablesConfig (plan-v2), растеризует sharp (librsvg). Шрифт — системный
// sans-serif: на VPS брендовых шрифтов нет, для схемы это ок.
//
// Всё best-effort: любой сбой рендера не должен ронять создание/подтверждение
// брони — вызывающие стороны обязаны оборачивать в try/catch.

const VB = PLAN_VB; // общий с FloorPlanSvg.jsx
const OUT_W = 1000;

const C = {
  bg: '#0C0A18',
  line: 'rgba(242,237,228,0.28)',
  tableFill: 'rgba(242,237,228,0.05)',
  tableStroke: 'rgba(242,237,228,0.38)',
  num: 'rgba(242,237,228,0.55)',
  gold: '#D4A843',
  goldDim: 'rgba(212,168,67,0.45)',
  goldFill: 'rgba(212,168,67,0.28)',
  dark: '#0C0A18',
};

const BAR = BAR_GEO;

function tableShapeSvg(t, highlighted) {
  const stroke = highlighted ? C.gold : C.tableStroke;
  const fill = highlighted ? C.goldFill : C.tableFill;
  const sw = highlighted ? 170 : 70;
  if (t.type === 'round') {
    const ring = highlighted
      ? `<circle cx="${t.cx}" cy="${t.cy}" r="${t.radius + 620}" fill="none" stroke="${C.goldDim}" stroke-width="90"/>`
      : '';
    return `${ring}<circle cx="${t.cx}" cy="${t.cy}" r="${t.radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }
  const ring = highlighted
    ? `<rect x="${t.x - 620}" y="${t.y - 620}" width="${t.w + 1240}" height="${t.h + 1240}" rx="480" fill="none" stroke="${C.goldDim}" stroke-width="90"/>`
    : '';
  return `${ring}<rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="240" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

function tableCenter(t) {
  return t.type === 'round' ? [t.cx, t.cy] : [t.x + t.w / 2, t.y + t.h / 2];
}

/**
 * PNG плана с выделенным столом. Возвращает Buffer.
 * @param {string} highlightTableId — внутренний id стола (T1…B2)
 */
export async function renderPlanPng(highlightTableId) {
  const parts = [];
  parts.push(`<rect x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" fill="${C.bg}"/>`);
  // стойка и декор
  parts.push(`<rect x="${BAR.x}" y="${BAR.y}" width="${BAR.w}" height="${BAR.h}" rx="${BAR.rx}" fill="rgba(212,168,67,0.06)" stroke="${C.goldDim}" stroke-width="60"/>`);
  parts.push(`<text x="${BAR.x + BAR.w / 2}" y="${BAR.y + 2050}" text-anchor="middle" font-family="sans-serif" font-size="1050" letter-spacing="300" fill="${C.goldDim}">BAR</text>`);
  for (const w of WINDOWS) {
    parts.push(`<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="90" fill="none" stroke="${C.line}" stroke-width="50"/>`);
  }
  // подписи зон — нумерация столов зонная («Основной зал №1», «У окна №2»…)
  for (const z of ZONE_LABELS) {
    parts.push(`<text x="${z.x}" y="${z.y}" text-anchor="middle" font-family="sans-serif" font-size="560" letter-spacing="220" fill="${C.num}">${z.ru}</text>`);
  }
  // столы: сперва обычные, выделенный — поверх
  const sorted = [...TABLES].sort((a, b) => (a.id === highlightTableId) - (b.id === highlightTableId));
  for (const t of sorted) {
    if (t.type === 'bar') continue;
    const hi = t.id === highlightTableId;
    parts.push(tableShapeSvg(t, hi));
    const [cx, cy] = tableCenter(t);
    parts.push(
      `<text x="${cx}" y="${cy + 330}" text-anchor="middle" font-family="sans-serif" font-weight="bold" `
      + `font-size="${hi ? 1250 : 850}" fill="${hi ? C.gold : C.num}">№${t.num ?? ''}</text>`,
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
