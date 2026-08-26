/**
 * Оформление цитаты бармена (секция «Бармены»).
 *
 * Прежняя рамка — квадрифолий-скобы по углам (DecoFrame) — на большом
 * рукописном тексте читалась как техническая рамка-конструктор. Здесь три
 * варианта «дорогой» подачи; владелец сравнивает вживую: ?quote=fan|card|plate
 * в адресе страницы. Выбранный станет дефолтом, лишние уедут.
 *
 * Чистый декор: pointer-events: none, без анимаций (движение в этой секции
 * ни к чему — цитата и так самый громкий элемент).
 */

/** Веер-медальон — тот же орнамент, что на страницах книги-меню. */
function Fan({ flip = false }) {
  const rays = [];
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI * i) / 8;
    rays.push(
      <line key={i} x1="44" y1="42"
        x2={(44 - 36 * Math.cos(a)).toFixed(1)} y2={(42 - 36 * Math.sin(a)).toFixed(1)} />,
    );
  }
  return (
    <svg className={`qfr__fan${flip ? ' qfr__fan--flip' : ''}`} viewBox="0 0 88 44"
      width="64" height="32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
      {rays}
      <path d="M8 42 A36 36 0 0 1 80 42" />
      <path d="M32 42 A12 12 0 0 1 56 42" />
    </svg>
  );
}

/** Знак-креманка бренда — точка в конце цитаты. */
function Coupe() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <path d="M4 6 L20 6 L12 15 Z" />
      <path d="M12 15 L12 20 M8 20 L16 20" />
    </svg>
  );
}

export default function QuoteFrame({ variant = 'fan' }) {
  if (variant === 'card') {
    return (
      <span className="qfr qfr--card" aria-hidden="true">
        <span className="qfr__rule qfr__rule--top" />
        <span className="qfr__mark">“</span>
        <span className="qfr__rule qfr__rule--bottom" />
        <span className="qfr__sign"><Coupe /></span>
      </span>
    );
  }
  if (variant === 'plate') {
    return (
      <span className="qfr qfr--plate" aria-hidden="true">
        <span className="qfr__engrave" />
        <span className="qfr__rivet qfr__rivet--tl" />
        <span className="qfr__rivet qfr__rivet--tr" />
        <span className="qfr__rivet qfr__rivet--bl" />
        <span className="qfr__rivet qfr__rivet--br" />
      </span>
    );
  }
  return (
    <span className="qfr qfr--fan" aria-hidden="true">
      <span className="qfr__box" />
      <span className="qfr__medal qfr__medal--top"><Fan flip /></span>
      <span className="qfr__medal qfr__medal--bottom"><Fan /></span>
      <span className="qfr__mark qfr__mark--left">“</span>
      <span className="qfr__mark qfr__mark--right">”</span>
    </span>
  );
}
