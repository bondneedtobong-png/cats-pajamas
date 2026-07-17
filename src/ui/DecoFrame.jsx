/**
 * Арт-деко рамка-квадрифолий (логобук, приём 2) — переиспользуемый декор.
 * Двойная L-скоба + узел-квадрифолий в каждом углу; `rays` добавляет
 * сунбёрст-лучи (вариант 1 «с лучами» — для парадных зон, напр. финальный CTA).
 * Чистый декор: pointer-events:none, без анимаций, пастельная обводка (--text).
 * Родитель должен быть position:relative и иметь внутренний отступ под рамку.
 */
const RAY_ANGLES = [18, 34, 50, 66, 82]; // веер от угла к центру

function DecoCorner({ rays }) {
  return (
    <svg className="deco-corner" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path className="deco-corner__l1" d="M11 62 L11 11 L62 11" />
      <path className="deco-corner__l2" d="M16 62 L16 16 L62 16" />
      {rays && (
        <g className="deco-corner__rays">
          {RAY_ANGLES.map((a) => {
            const r = (a * Math.PI) / 180;
            return (
              <line key={a}
                x1={(13 + 17 * Math.cos(r)).toFixed(1)} y1={(13 + 17 * Math.sin(r)).toFixed(1)}
                x2={(13 + 30 * Math.cos(r)).toFixed(1)} y2={(13 + 30 * Math.sin(r)).toFixed(1)} />
            );
          })}
        </g>
      )}
      <g className="deco-corner__quat">
        <circle cx="13" cy="8.7" r="4.3" /><circle cx="17.3" cy="13" r="4.3" />
        <circle cx="13" cy="17.3" r="4.3" /><circle cx="8.7" cy="13" r="4.3" />
        <circle cx="13" cy="13" r="2.6" />
      </g>
    </svg>
  );
}

export default function DecoFrame({ rays = false, className = '' }) {
  return (
    <div className={`deco-frame${rays ? ' deco-frame--rays' : ''}${className ? ' ' + className : ''}`} aria-hidden="true">
      <span className="deco-frame__corner deco-frame__corner--tl"><DecoCorner rays={rays} /></span>
      <span className="deco-frame__corner deco-frame__corner--tr"><DecoCorner rays={rays} /></span>
      <span className="deco-frame__corner deco-frame__corner--bl"><DecoCorner rays={rays} /></span>
      <span className="deco-frame__corner deco-frame__corner--br"><DecoCorner rays={rays} /></span>
    </div>
  );
}
