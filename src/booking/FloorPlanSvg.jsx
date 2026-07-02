import { BAR_STOOL_W, BAR_STOOL_H } from './tablesConfig.js';

const SC = { vacant: '#22c55e', reserved: '#D4A843', occupied: '#9B5DE5' };
const FILL = {
  vacant:   'rgba(34,197,94,0.09)',
  reserved: 'rgba(212,168,67,0.09)',
  occupied: 'rgba(155,93,229,0.13)',
};
const SEL_FILL = {
  vacant:   'rgba(34,197,94,0.2)',
  reserved: 'rgba(212,168,67,0.2)',
  occupied: 'rgba(155,93,229,0.25)',
};
const LBL = { vacant: 'Свободен', reserved: 'Скоро', occupied: 'Занят' };

const noPtr = { pointerEvents: 'none' };
const noSel = { pointerEvents: 'none', userSelect: 'none' };

/**
 * Compute SVG world position and rotation for a chair around a table.
 * Angle convention: 0 = East (+X), 90 = South (+Y), standard SVG math.
 * rotate(angle + 90) orients the chair so its seat faces the table centre.
 */
function getChairPos(tbl, seat) {
  const rad = seat.angle * Math.PI / 180;
  const rot = seat.angle + 90;

  if (tbl.type === 'round') {
    const dist = (tbl.radius || 1500) + 120;
    return { wx: tbl.cx + dist * Math.cos(rad), wy: tbl.cy + dist * Math.sin(rad), rot };
  }

  // Square / booth: snap to nearest edge
  const cx = tbl.x + tbl.w / 2, cy = tbl.y + tbl.h / 2;
  const D = 280;
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

// Chair in local coords: backrest at local -Y (outer/away from table),
// seat cushion at local +Y (inner/toward table). rotate(angle+90) orients correctly.
function ChairShape({ tbl, seat, isSel }) {
  if (!seat || typeof seat.angle !== 'number' || !seat.active || tbl.type === 'booth' || tbl.type === 'bar') return null;
  const { wx, wy, rot } = getChairPos(tbl, seat);
  const sc = isSel ? 'rgba(212,168,67,0.42)' : 'rgba(212,168,67,0.22)';
  const sf = isSel ? 'rgba(212,168,67,0.10)' : 'rgba(212,168,67,0.06)';
  return (
    <g transform={`translate(${wx}, ${wy}) rotate(${rot})`} style={noPtr}>
      <rect x={-300} y={-355} width={600} height={165} rx={75}  fill={sf} stroke={sc} strokeWidth={28} />
      <rect x={-275} y={-185} width={550} height={470} rx={110} fill={sf} stroke={sc} strokeWidth={28} />
    </g>
  );
}

function TableShape({ tbl, selectedTableId, onSelect }) {
  const { status, reservation } = tbl;
  const isSel   = tbl.id === selectedTableId;
  const stroke  = isSel ? '#FFFFFF' : SC[status];
  const sw      = isSel ? 70 : 42;
  const fill    = isSel ? SEL_FILL[status] : FILL[status];
  const nameStr = reservation ? (reservation.guestName?.split(' ')[0] || LBL[status]) : LBL[status];
  const timeStr = reservation ? reservation.timeFrom : '';
  const seats   = tbl.activeSeatsCount;

  const handleClick = (e) => { e.stopPropagation(); onSelect(tbl.id); };

  // Pulsing ring draws attention to tables that are about to be occupied.
  const pulseCls = status === 'reserved' ? 'fp-pulse-ring' : undefined;

  // Bar stools are small — render a compact stool with just the id, no big labels.
  if (tbl.type === 'bar') {
    const bx = tbl.bx, by = tbl.by;
    const m = 200;
    return (
      <g key={tbl.id} className="fp-table" style={{ cursor: 'pointer' }} onClick={handleClick}>
        <rect className={pulseCls} x={bx - m} y={by - m} width={BAR_STOOL_W + 2 * m} height={BAR_STOOL_H + 2 * m} rx={320} fill="none" stroke={SC[status]} strokeWidth={14} opacity={0.18} style={noPtr} />
        <rect x={bx} y={by} width={BAR_STOOL_W} height={BAR_STOOL_H} rx={215} fill={fill} stroke={stroke} strokeWidth={isSel ? 46 : 26} />
        <text x={bx + BAR_STOOL_W / 2} y={by + BAR_STOOL_H / 2 + 95} textAnchor="middle" fill="rgba(242,237,228,0.85)" fontSize={260} fontFamily="Avenir Next,sans-serif" fontWeight={700} style={noSel}>{tbl.id}</text>
      </g>
    );
  }

  let cx, cy, shape;
  if (tbl.type === 'round') {
    cx = tbl.cx; cy = tbl.cy;
    shape = (
      <>
        <circle className={pulseCls} cx={cx} cy={cy} r={1850} fill="none" stroke={SC[status]} strokeWidth={16} opacity={0.18} style={noPtr} />
        <circle cx={cx} cy={cy} r={1500} fill={fill} stroke={stroke} strokeWidth={sw} />
      </>
    );
  } else {
    cx = tbl.x + tbl.w / 2; cy = tbl.y + tbl.h / 2;
    const m = 350;
    shape = (
      <>
        <rect className={pulseCls} x={tbl.x - m} y={tbl.y - m} width={tbl.w + 2 * m} height={tbl.h + 2 * m} rx={320} fill="none" stroke={SC[status]} strokeWidth={16} opacity={0.18} style={noPtr} />
        <rect x={tbl.x} y={tbl.y} width={tbl.w} height={tbl.h} rx={220} fill={fill} stroke={stroke} strokeWidth={sw} />
      </>
    );
  }

  return (
    <g key={tbl.id} className="fp-table" style={{ cursor: 'pointer' }} onClick={handleClick}>
      {/* Chairs rendered behind the table shape */}
      {tbl.seats && tbl.seats.map((seat, i) => (
        <ChairShape key={i} tbl={tbl} seat={seat} isSel={isSel} />
      ))}
      {shape}
      <text x={cx} y={cy - 380}  textAnchor="middle" fill="rgba(242,237,228,0.9)" fontSize={480} fontFamily="Avenir Next,sans-serif" fontWeight={700} style={noSel}>{tbl.id}</text>
      <text x={cx} y={cy + 160}  textAnchor="middle" fill={SC[status]} fontSize={340} fontFamily="Avenir Next,sans-serif" style={noSel}>{nameStr}</text>
      {timeStr && <text x={cx} y={cy + 580} textAnchor="middle" fill="rgba(242,237,228,0.42)" fontSize={290} fontFamily="Avenir Next,sans-serif" style={noSel}>{timeStr}</text>}
      <text x={cx} y={cy + (timeStr ? 980 : 600)} textAnchor="middle" fill="rgba(242,237,228,0.25)" fontSize={260} fontFamily="Avenir Next,sans-serif" style={noSel}>{seats} мест</text>
    </g>
  );
}

export default function FloorPlanSvg({ tables, selectedTableId, onSelect, onDeselect }) {
  return (
    <svg
      viewBox="0 0 29700 21000"
      style={{ width: '100%', height: '100%', display: 'block' }}
      preserveAspectRatio="xMidYMid meet"
      onClick={onDeselect}
    >
      <defs>
        <pattern id="fpg" x={0} y={0} width={1500} height={1500} patternUnits="userSpaceOnUse">
          <path d="M1500 0L0 0 0 1500" fill="none" stroke="rgba(212,168,67,0.03)" strokeWidth={12} />
        </pattern>
      </defs>

      {/* Background */}
      <rect x={0} y={0} width={29700} height={21000} fill="#090718" />
      <rect x={0} y={0} width={29700} height={21000} fill="url(#fpg)" style={noPtr} />

      {/* Room border */}
      <rect x={200} y={200} width={29300} height={20600} fill="none" stroke="rgba(212,168,67,0.09)" strokeWidth={70} style={noPtr} />

      {/* Bar counter */}
      <polygon
        points="8368,200 23152,200 23152,3843 8368,3879"
        fill="rgba(155,93,229,0.04)"
        stroke="rgba(212,168,67,0.16)"
        strokeWidth={38}
        style={noPtr}
      />
      <text x={15760} y={2350} textAnchor="middle" fill="rgba(212,168,67,0.2)" fontSize={750} fontFamily="Avenir Next,sans-serif" letterSpacing={180} style={noSel}>БАР</text>


      {/* Wall sofas (left side — visual context for booth zones) */}
      <rect x={328}  y={4493}  width={700} height={3500} rx={200} fill="rgba(155,93,229,0.06)" stroke="rgba(155,93,229,0.18)" strokeWidth={20} style={noPtr} />
      <rect x={254}  y={11118} width={700} height={3500} rx={200} fill="rgba(155,93,229,0.06)" stroke="rgba(155,93,229,0.18)" strokeWidth={20} style={noPtr} />

      {/* Zone labels */}
      <text x={10500} y={20400} fill="rgba(212,168,67,0.07)" fontSize={1100} fontFamily="Baskerville,serif" fontStyle="italic" style={noSel}>Основной зал</text>
      <text x={19800} y={20400} fill="rgba(212,168,67,0.07)" fontSize={1100} fontFamily="Baskerville,serif" fontStyle="italic" style={noSel}>VIP</text>
      <text x={300}   y={20400} fill="rgba(212,168,67,0.07)" fontSize={1100} fontFamily="Baskerville,serif" fontStyle="italic" style={noSel}>Диваны</text>

      {/* Interactive tables */}
      {tables.map(tbl => (
        <TableShape
          key={tbl.id}
          tbl={tbl}
          selectedTableId={selectedTableId}
          onSelect={onSelect}
        />
      ))}
    </svg>
  );
}
