/**
 * План зала v2 — геометрия из design/plan-v2.svg (30000×30000 world units).
 * Интерактивны только столы из tablesConfig; барная стойка и декор не
 * кликабельны. Цвета — токены темы через классы в booking.css (скоуп .fp-svg):
 * исходные #D7D8D8/#2B2A29 из CorelDRAW-экспорта здесь не используются.
 */
import { ZONE_LABELS, WINDOWS, BAR_GEO, PLAN_VB } from './tablesConfig.js';

const noPtr = { pointerEvents: 'none' };
const noSel = { pointerEvents: 'none', userSelect: 'none' };

// Дефолтные подписи (RU) — страница передаёт tx со своего языка (data.js)
const T_DEF = {
  statusVacant: 'Свободен',
  statusReservedAt: 'Бронь к',
  statusOccupied: 'Занят',
  barNote: 'Стойка не бронируется — просто приходите',
  seatsWord: 'мест',
  zoneMain: 'ОСНОВНОЙ ЗАЛ',
  zoneWindow: 'У ОКНА',
  zoneSofas: 'ДИВАНЫ',
};

// Геометрия стойки/дуги/окон — общая с planImage.js, живёт в tablesConfig
const BAR = BAR_GEO;

function TableShape({ tbl, selectedTableId, onSelect, tx }) {
  const { status, reservation } = tbl;
  const isSel = tbl.id === selectedTableId;
  const statusText = status === 'vacant' ? tx.statusVacant
    : status === 'occupied' ? tx.statusOccupied
    : `${tx.statusReservedAt} ${reservation?.timeFrom || ''}`.trim();

  const handleClick = (e) => { e.stopPropagation(); onSelect(tbl.id); };
  const cls = `fp-table fp-t--${status}${isSel ? ' fp-t--sel' : ''}`;

  // Кольцо у reserved-стола — СТАТИЧНОЕ: анимации внутри SVG заставляют
  // браузер перерисовывать план каждый кадр (профилировано — фризы на
  // слабых машинах), поэтому в .fp-svg нет ни одной animation/transition.
  let cx, cy, shape, numDy, statusDy, statusFs;
  if (tbl.type === 'round') {
    cx = tbl.cx; cy = tbl.cy;
    numDy = -560; statusDy = 340; statusFs = 460;
    shape = (
      <>
        {status === 'reserved' && (
          <circle className="fp-ring" cx={cx} cy={cy} r={(tbl.radius || 2400) + 380} style={noPtr} />
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
          <rect className="fp-ring" x={tbl.x - m} y={tbl.y - m} width={tbl.w + 2 * m} height={tbl.h + 2 * m} rx={420} style={noPtr} />
        )}
        <rect className="fp-t-shape" x={tbl.x} y={tbl.y} width={tbl.w} height={tbl.h} rx={220} />
      </>
    );
  }

  return (
    <g className={cls} onClick={handleClick}>
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
      {/* ── Декор: окна на нижней стене (центральный вход — проём между ними) ── */}
      <g className="fp-decor" style={noPtr}>
        {WINDOWS.map((w, i) => (
          <g key={i} className="fp-window">
            <rect x={w.x} y={w.y} width={w.w} height={w.h} rx={90} />
            <line x1={w.x + 260} y1={w.y + w.h / 2} x2={w.x + w.w - 260} y2={w.y + w.h / 2} />
          </g>
        ))}
      </g>

      {/* ── Барная стойка: НЕ кликабельна, НЕ бронируется. Свечение статично;
             пульс — HTML-оверлеем поверх плана (композитно, не трогает SVG) ── */}
      <g className="fp-bar" style={noPtr}>
        <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={BAR.rx} className="fp-bar-glow__inner" />
        <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={BAR.rx} className="fp-bar-body" />
        <text className="fp-bar-title" x={BAR.x + BAR.w / 2} y={BAR.y + 1500} textAnchor="middle" fontSize={820} letterSpacing={200} style={noSel}>
          BAR
        </text>
        <text className="fp-bar-note" x={BAR.x + BAR.w / 2} y={BAR.y + 2700} textAnchor="middle" fontSize={470} style={noSel}>
          {tx.barNote}
        </text>
      </g>

      {/* ── Подписи зон (нумерация столов — внутри зоны; «У окна» ×2) ── */}
      {ZONE_LABELS.map((z, i) => (
        <text key={i} className="fp-zone-label" x={z.x} y={z.y} textAnchor="middle" fontSize={520} letterSpacing={220} style={noSel}>
          {tx[z.key] || z.ru}
        </text>
      ))}

      {/* Стулья убраны по просьбе владельца — на плане только чистые столы. */}

      {/* ── Интерактивные столы ── */}
      {tables.filter(t => t.type !== 'bar').map(tbl => (
        <TableShape key={tbl.id} tbl={tbl} selectedTableId={selectedTableId} onSelect={onSelect} tx={tx} />
      ))}
    </svg>
  );
}
