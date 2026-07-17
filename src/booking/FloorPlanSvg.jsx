/**
 * План зала v4 — «интерьер, а не схема». Геометрия столов — из tablesConfig
 * (30000-канвас), мебель (стулья вокруг столов, диваны) — из furniture.js.
 * Цвета — токены статусов через классы booking.css (скоуп .fp-svg).
 *
 * ⚠️ Внутри .fp-svg НЕТ ни одной animation/transition (профилировано: любое
 * изменение внутри плана перерисовывает его на CPU каждый кадр). Всё «живое» —
 * HTML-оверлеями поверх (см. .bkw__glowbar) либо мгновенной сменой классов.
 * Стулья/обивка — декор (pointer-events: none), кликабельна форма стола.
 */
import { ZONE_LABELS, WINDOWS, BAR_GEO, PLAN_VB } from './tablesConfig.js';
import { CHAIR, chairsFor, boothParts } from './furniture.js';

const noPtr = { pointerEvents: 'none' };
const noSel = { pointerEvents: 'none', userSelect: 'none' };

const T_DEF = {
  statusVacant: 'Свободен',
  statusReservedAt: 'к',
  statusOccupied: 'Занят',
  barNote: 'Стойка не бронируется — просто приходите',
  entrance: 'ВХОД',
  seatsWord: 'мест',
  zoneMain: 'ОСНОВНОЙ ЗАЛ',
  zoneWindow: 'У ОКНА',
  zoneSofas: 'ДИВАНЫ',
};

const BAR = BAR_GEO;
// Центр проёма-входа между двумя окнами нижней стены.
const ENTRANCE_X = (WINDOWS[0].x + WINDOWS[0].w + WINDOWS[1].x) / 2;

// ── Стул «сверху»: спинка (полоса) + сиденье, канонически смотрит вниз, при
//    размещении довёрнут к столу. Чистый декор. ──
function Chair({ x, y, rot }) {
  const s = CHAIR;
  const seatY = -s.seatH / 2 + 120;
  const backY = seatY - s.backH - 40;
  return (
    <g className="fp-chair" transform={`translate(${x.toFixed(0)} ${y.toFixed(0)}) rotate(${rot.toFixed(1)})`} style={noPtr}>
      <rect x={-s.backW / 2} y={backY} width={s.backW} height={s.backH} rx={s.backR} />
      <rect x={-s.seatW / 2} y={seatY} width={s.seatW} height={s.seatH} rx={s.seatR} />
    </g>
  );
}

// Мебельная «оболочка» стола: стулья (круг/квадрат) или обивка дивана.
function Furniture({ tbl }) {
  if (tbl.type === 'booth') {
    const b = boothParts(tbl.x, tbl.y, tbl.w, tbl.h);
    return (
      <g className="fp-chair" style={noPtr}>
        <rect x={b.back.x} y={b.back.y} width={b.back.w} height={b.back.h} rx={b.back.r} />
        {b.arms.map((a, i) => (
          <rect key={i} x={a.x} y={a.y} width={a.w} height={a.h} rx={a.r} />
        ))}
      </g>
    );
  }
  return chairsFor(tbl).map((ch, i) => <Chair key={i} {...ch} />);
}

function TableShape({ tbl, selectedTableId, onSelect, tx }) {
  const { status, reservation } = tbl;
  const isSel = tbl.id === selectedTableId;
  const statusText = status === 'vacant' ? tx.statusVacant
    : status === 'occupied' ? tx.statusOccupied
    : `${tx.statusReservedAt} ${reservation?.timeFrom || ''}`.trim();

  const handleClick = (e) => { e.stopPropagation(); onSelect(tbl.id); };
  const cls = `fp-table fp-t--${status}${isSel ? ' fp-t--sel' : ''}`;

  // Центр стола + геометрия столешницы, ободка (глубина) и колец выделения.
  let cx, cy, shape, seams = null;
  if (tbl.type === 'round') {
    cx = tbl.cx; cy = tbl.cy;
    const r = tbl.radius || 2200;
    shape = (
      <>
        {isSel && <circle className="fp-sel-outer" cx={cx} cy={cy} r={r + 520} style={noPtr} />}
        {isSel && <circle className="fp-sel-inner" cx={cx} cy={cy} r={r + 300} style={noPtr} />}
        <circle className="fp-t-shape" cx={cx} cy={cy} r={r} />
        <circle className="fp-t-rim" cx={cx} cy={cy} r={r - 230} style={noPtr} />
      </>
    );
  } else if (tbl.type === 'square') {
    cx = tbl.x + tbl.w / 2; cy = tbl.y + tbl.h / 2;
    const m = 300;
    shape = (
      <>
        {isSel && <rect className="fp-sel-outer" x={tbl.x - m - 220} y={tbl.y - m - 220} width={tbl.w + 2 * (m + 220)} height={tbl.h + 2 * (m + 220)} rx={520} style={noPtr} />}
        {isSel && <rect className="fp-sel-inner" x={tbl.x - m} y={tbl.y - m} width={tbl.w + 2 * m} height={tbl.h + 2 * m} rx={420} style={noPtr} />}
        <rect className="fp-t-shape" x={tbl.x} y={tbl.y} width={tbl.w} height={tbl.h} rx={240} />
        <rect className="fp-t-rim" x={tbl.x + 230} y={tbl.y + 230} width={tbl.w - 460} height={tbl.h - 460} rx={150} style={noPtr} />
      </>
    );
  } else { // booth: кликабельна «подушка» сиденья
    const b = boothParts(tbl.x, tbl.y, tbl.w, tbl.h);
    cx = b.seat.x + b.seat.w / 2; cy = b.seat.y + b.seat.h / 2;
    const m = 240;
    seams = b.seams;
    shape = (
      <>
        {isSel && <rect className="fp-sel-outer" x={b.seat.x - m - 200} y={b.seat.y - m - 200} width={b.seat.w + 2 * (m + 200)} height={b.seat.h + 2 * (m + 200)} rx={420} style={noPtr} />}
        {isSel && <rect className="fp-sel-inner" x={b.seat.x - m} y={b.seat.y - m} width={b.seat.w + 2 * m} height={b.seat.h + 2 * m} rx={320} style={noPtr} />}
        <rect className="fp-t-shape" x={b.seat.x} y={b.seat.y} width={b.seat.w} height={b.seat.h} rx={b.seat.r} />
      </>
    );
  }

  return (
    <g className={cls} onClick={handleClick}>
      <Furniture tbl={tbl} />
      {shape}
      {seams && (
        <g className="fp-seam" style={noPtr}>
          {seams.map((s, i) => <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />)}
        </g>
      )}
      {/* Номер стола (зонная нумерация 1–4; внутренние id гостю не видны) */}
      <text className="fp-t-num" x={cx} y={cy - 240} textAnchor="middle" fontSize={620} style={noSel}>
        №{tbl.num ?? ''}
      </text>
      {/* Статус текстом рядом с цветом (доступность: не только цветовая метка) */}
      <text className="fp-t-status" x={cx} y={cy + 560} textAnchor="middle" fontSize={430} style={noSel}>
        {statusText}
      </text>
    </g>
  );
}

const VB = PLAN_VB;

export default function FloorPlanSvg({ tables, selectedTableId, onSelect, onDeselect, tx: txProp }) {
  const tx = { ...T_DEF, ...txProp };
  return (
    <svg
      className="fp-svg"
      viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
      style={{ width: '100%', height: '100%', display: 'block' }}
      preserveAspectRatio="xMidYMid meet"
      onClick={onDeselect}
    >
      {/* Материальность зала: мягкая виньетка по краям (радиальный градиент) */}
      <defs>
        <radialGradient id="fp-vignette" cx="50%" cy="42%" r="72%">
          <stop offset="0%" stopColor="#000" stopOpacity="0" />
          <stop offset="78%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.32" />
        </radialGradient>
      </defs>
      <rect className="fp-vignette" x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="url(#fp-vignette)" style={noPtr} />

      {/* ── Декор: окна на нижней стене + подпись входа (проём между окнами) ── */}
      <g className="fp-decor" style={noPtr}>
        {WINDOWS.map((w, i) => (
          <g key={i} className="fp-window">
            <rect x={w.x} y={w.y} width={w.w} height={w.h} rx={90} />
            <line x1={w.x + 260} y1={w.y + w.h / 2} x2={w.x + w.w - 260} y2={w.y + w.h / 2} />
          </g>
        ))}
        <text className="fp-entrance" x={ENTRANCE_X} y={WINDOWS[0].y + 190} textAnchor="middle" fontSize={470} letterSpacing={160} style={noSel}>
          {tx.entrance}
        </text>
      </g>

      {/* ── Барная стойка: не кликабельна, не бронируется. Пульс — HTML-оверлей. ── */}
      <g className="fp-bar" style={noPtr}>
        <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={BAR.rx} className="fp-bar-glow__inner" />
        <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={BAR.rx} className="fp-bar-body" />
        <text className="fp-bar-title" x={BAR.x + BAR.w / 2} y={BAR.y + 1520} textAnchor="middle" fontSize={820} letterSpacing={200} style={noSel}>
          BAR
        </text>
        <text className="fp-bar-note" x={BAR.x + BAR.w / 2} y={BAR.y + 2720} textAnchor="middle" fontSize={470} style={noSel}>
          {tx.barNote}
        </text>
      </g>

      {/* ── Подписи зон ── */}
      {ZONE_LABELS.map((z, i) => (
        <text key={i} className="fp-zone-label" x={z.x} y={z.y} textAnchor="middle" fontSize={520} letterSpacing={220} style={noSel}>
          {tx[z.key] || z.ru}
        </text>
      ))}

      {/* ── Столы с мебелью ── */}
      {tables.filter(t => t.type !== 'bar').map(tbl => (
        <TableShape key={tbl.id} tbl={tbl} selectedTableId={selectedTableId} onSelect={onSelect} tx={tx} />
      ))}
    </svg>
  );
}
