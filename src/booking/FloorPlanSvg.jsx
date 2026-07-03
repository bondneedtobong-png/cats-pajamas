/**
 * План зала v2 — геометрия из design/plan-v2.svg (30000×30000 world units).
 * Интерактивны только столы из tablesConfig; барная стойка и декор не
 * кликабельны. Цвета — токены темы через классы в booking.css (скоуп .fp-svg):
 * исходные #D7D8D8/#2B2A29 из CorelDRAW-экспорта здесь не используются.
 */
import { PLAN_W, PLAN_H } from './tablesConfig.js';

const noPtr = { pointerEvents: 'none' };
const noSel = { pointerEvents: 'none', userSelect: 'none' };

// Дефолтные подписи (RU) — страница передаёт tx со своего языка (data.js)
const T_DEF = {
  statusVacant: 'Свободен',
  statusReservedAt: 'Бронь к',
  statusOccupied: 'Занят',
  barNote: 'Стойка не бронируется — просто приходите',
  seatsWord: 'мест',
};

// Декоративная дуга через верх зала (стена/сцена) — из plan-v2.svg как есть
const DECOR_ARC_D = 'M27322.13 2749.55c-6992.43,3818.13 -18287.38,3819.15 -25228,2.29';

// Барная стойка: скруглённый прямоугольник сверху по центру (из path
// M8179,4093 в plan-v2.svg; верхний край чуть выше нулевой линии — как в исходнике)
const BAR = { x: 7979.6, y: -70, w: 13200.8, h: 4163, rx: 200 };

// Приставные места лаунж-зоны (узкие банкетки + пуфы слева от диванов) —
// декор, отдельно не бронируются (§4 ТЗ)
const SIDE_RECTS = [
  { x: 244.39, y: 7206.06, w: 1155.63, h: 7329.95 },
  { x: 289.93, y: 15919, w: 1155.63, h: 7329.95 },
];
const SIDE_POUFS = [
  { cx: 803.19, cy: 7760.2 }, { cx: 803.19, cy: 13966.56 },
  { cx: 848.74, cy: 16473.15 }, { cx: 848.74, cy: 22679.51 },
];

/**
 * Position and rotation for a chair around a table (decorative).
 * Angle: 0 = East, 90 = South (standard SVG math); rotate(angle+90) turns
 * the chair so its seat faces the table centre.
 */
function getChairPos(tbl, seat) {
  const rad = seat.angle * Math.PI / 180;
  const rot = seat.angle + 90;
  if (tbl.type === 'round') {
    const dist = (tbl.radius || 2400) + 220;
    return { wx: tbl.cx + dist * Math.cos(rad), wy: tbl.cy + dist * Math.sin(rad), rot };
  }
  // Square: snap to nearest edge
  const cx = tbl.x + tbl.w / 2, cy = tbl.y + tbl.h / 2;
  const D = 420;
  const a = ((seat.angle % 360) + 360) % 360;
  let wx, wy;
  switch (a) {
    case 0:   wx = tbl.x + tbl.w + D; wy = cy; break;
    case 45:  wx = tbl.x + tbl.w + D * 0.7; wy = tbl.y + tbl.h + D * 0.7; break;
    case 90:  wx = cx; wy = tbl.y + tbl.h + D; break;
    case 135: wx = tbl.x - D * 0.7; wy = tbl.y + tbl.h + D * 0.7; break;
    case 180: wx = tbl.x - D; wy = cy; break;
    case 225: wx = tbl.x - D * 0.7; wy = tbl.y - D * 0.7; break;
    case 270: wx = cx; wy = tbl.y - D; break;
    case 315: wx = tbl.x + tbl.w + D * 0.7; wy = tbl.y - D * 0.7; break;
    default: { const d = Math.max(tbl.w, tbl.h) / 2 + D; wx = cx + d * Math.cos(rad); wy = cy + d * Math.sin(rad); }
  }
  return { wx, wy, rot };
}

// Chair in local coords: backrest at -Y (away from table), cushion at +Y.
function ChairShape({ tbl, seat }) {
  if (!seat || typeof seat.angle !== 'number' || !seat.active || tbl.type === 'booth') return null;
  const { wx, wy, rot } = getChairPos(tbl, seat);
  return (
    <g className="fp-chair" transform={`translate(${wx}, ${wy}) rotate(${rot})`} style={noPtr}>
      <rect x={-390} y={-470} width={780} height={215} rx={95} />
      <rect x={-355} y={-240} width={710} height={610} rx={140} />
    </g>
  );
}

function TableShape({ tbl, selectedTableId, onSelect, tx }) {
  const { status, reservation } = tbl;
  const isSel = tbl.id === selectedTableId;
  const statusText = status === 'vacant' ? tx.statusVacant
    : status === 'occupied' ? tx.statusOccupied
    : `${tx.statusReservedAt} ${reservation?.timeFrom || ''}`.trim();

  const handleClick = (e) => { e.stopPropagation(); onSelect(tbl.id); };
  const cls = `fp-table fp-t--${status}${isSel ? ' fp-t--sel' : ''}`;

  let cx, cy, shape, numDy, statusDy, statusFs;
  if (tbl.type === 'round') {
    cx = tbl.cx; cy = tbl.cy;
    numDy = -560; statusDy = 340; statusFs = 460;
    shape = (
      <>
        {status === 'reserved' && (
          <circle className="fp-pulse-ring" cx={cx} cy={cy} r={(tbl.radius || 2400) + 380} style={noPtr} />
        )}
        <circle className="fp-t-shape" cx={cx} cy={cy} r={tbl.radius || 2400} />
      </>
    );
  } else {
    cx = tbl.x + tbl.w / 2; cy = tbl.y + tbl.h / 2;
    const booth = tbl.type === 'booth';
    numDy = booth ? -720 : -560;
    statusDy = booth ? 260 : 340;
    statusFs = booth ? 420 : 460;
    const m = 380;
    shape = (
      <>
        {status === 'reserved' && (
          <rect className="fp-pulse-ring" x={tbl.x - m} y={tbl.y - m} width={tbl.w + 2 * m} height={tbl.h + 2 * m} rx={420} style={noPtr} />
        )}
        <rect className="fp-t-shape" x={tbl.x} y={tbl.y} width={tbl.w} height={tbl.h} rx={220} />
      </>
    );
  }

  return (
    <g className={cls} onClick={handleClick}>
      {tbl.seats && tbl.seats.map((seat, i) => <ChairShape key={i} tbl={tbl} seat={seat} />)}
      {shape}
      {/* Лёгкая нумерация 1–9 (внутренние id гостю не показываются) */}
      <text className="fp-t-num" x={cx} y={cy + numDy} textAnchor="middle" fontSize={400} style={noSel}>
        №{tbl.num ?? ''}
      </text>
      {/* Статус ОБЯЗАТЕЛЬНО текстом рядом с цветом — не только цветовая метка */}
      <text className="fp-t-status" x={cx} y={cy + statusDy} textAnchor="middle" fontSize={statusFs} style={noSel}>
        {statusText}
      </text>
    </g>
  );
}

export default function FloorPlanSvg({ tables, selectedTableId, onSelect, onDeselect, tx: txProp }) {
  const tx = { ...T_DEF, ...txProp };
  return (
    <svg
      className="fp-svg"
      viewBox={`0 -400 ${PLAN_W} ${PLAN_H + 400}`}
      style={{ width: '100%', height: '100%', display: 'block' }}
      preserveAspectRatio="xMidYMid meet"
      onClick={onDeselect}
    >
      {/* ── Декор: дуга-стена и приставные места лаунжа ── */}
      <g className="fp-decor" style={noPtr}>
        <path d={DECOR_ARC_D} fill="none" />
        {SIDE_RECTS.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={200} />
        ))}
        {SIDE_POUFS.map((p, i) => (
          <ellipse key={i} cx={p.cx} cy={p.cy} rx={542} ry={558} />
        ))}
      </g>

      {/* ── Барная стойка: glow-акцент, НЕ кликабельна, НЕ бронируется ── */}
      <g className="fp-bar" style={noPtr}>
        {/* Готовый glow-слой — анимируется только его opacity (web-polish);
            пауза на неактивных страницах книги и при reduced-motion — в CSS */}
        <g className="fp-bar-glow">
          <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={BAR.rx} className="fp-bar-glow__outer" />
          <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={BAR.rx} className="fp-bar-glow__inner" />
        </g>
        <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={BAR.rx} className="fp-bar-body" />
        <text className="fp-bar-title" x={BAR.x + BAR.w / 2} y={1750} textAnchor="middle" fontSize={720} letterSpacing={170} style={noSel}>
          BAR
        </text>
        <text className="fp-bar-note" x={BAR.x + BAR.w / 2} y={2900} textAnchor="middle" fontSize={430} style={noSel}>
          {tx.barNote}
        </text>
      </g>

      {/* ── Интерактивные столы ── */}
      {tables.filter(t => t.type !== 'bar').map(tbl => (
        <TableShape key={tbl.id} tbl={tbl} selectedTableId={selectedTableId} onSelect={onSelect} tx={tx} />
      ))}
    </svg>
  );
}
