import './barmenu.css';

// Карточка категории бар-меню в стиле бумажного меню (рамка, веера, курсив).
// Используется в двух местах: страница книги «Напитки» (src/sections/Menu.jsx)
// и standalone-страница /menu (BarMenuPage.jsx). Правишь вид карточки — правь
// и строковый маркап в scripts/prerender-menu.mjs (SEO-снапшот /menu).

export function Fan({ flip = false }) {
  const rays = [];
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI * i) / 8; // 0..180°
    const x = 44 - 36 * Math.cos(a);
    const y = 42 - 36 * Math.sin(a);
    rays.push(<line key={i} x1="44" y1="42" x2={x.toFixed(1)} y2={y.toFixed(1)} />);
  }
  return (
    <svg
      className={`bmn-fan${flip ? ' bmn-fan--flip' : ''}`}
      viewBox="0 0 88 44" width="66" height="33" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.3"
    >
      {rays}
      <path d="M8 42 A36 36 0 0 1 80 42" />
      <path d="M32 42 A12 12 0 0 1 56 42" fill="var(--bmn-card)" />
    </svg>
  );
}

export function CornerFan() {
  const rays = [];
  for (let i = 0; i <= 3; i++) {
    const a = (Math.PI / 2) * (i / 3); // 0..90°
    const x = 2 + 26 * Math.cos(a);
    const y = 2 + 26 * Math.sin(a);
    rays.push(<line key={i} x1="2" y1="2" x2={x.toFixed(1)} y2={y.toFixed(1)} />);
  }
  return (
    <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.2">
      {rays}
      <path d="M28 2 A26 26 0 0 1 2 28" />
    </svg>
  );
}

function MenuItem({ item, unit }) {
  const volume = item.volume ?? unit ?? '';
  return (
    <li className="bmn-item">
      <span className="bmn-item__name">{item.name}</span>
      {item.origin && <span className="bmn-item__origin">{item.origin}</span>}
      <span className="bmn-item__line">
        <span className="bmn-item__vol">{volume}</span>
        <span className="bmn-item__leader" aria-hidden="true" />
        <span className="bmn-item__price">{item.price}</span>
      </span>
    </li>
  );
}

/** Лист бумажного меню. showHead=false — «второй лист» разворота без заголовка. */
export function CategoryCard({ cat, showHead = true }) {
  return (
    <article className="bmn-card">
      <div className="bmn-card__inner">
        <span className="bmn-corner bmn-corner--tl"><CornerFan /></span>
        <span className="bmn-corner bmn-corner--tr"><CornerFan /></span>
        <span className="bmn-corner bmn-corner--bl"><CornerFan /></span>
        <span className="bmn-corner bmn-corner--br"><CornerFan /></span>
        {/* сверху веер раскрыт вниз (flip), снизу — вверх, как на бумажных карточках */}
        <span className="bmn-card__fan bmn-card__fan--top"><Fan flip /></span>
        <span className="bmn-card__fan bmn-card__fan--bottom"><Fan /></span>

        {showHead && <h3 className="bmn-card__title">{cat.title}</h3>}
        {showHead && cat.unit && <p className="bmn-card__unit">{cat.unit}</p>}

        <ul className="bmn-card__list">
          {cat.items.map((item) => (
            <MenuItem key={item.name + item.price} item={item} unit={cat.unit} />
          ))}
        </ul>

        {cat.quote && (
          <figure className="bmn-quote">
            <blockquote className="bmn-quote__text">«{cat.quote.text}»</blockquote>
            <figcaption className="bmn-quote__sign">{cat.quote.author}</figcaption>
          </figure>
        )}
      </div>
    </article>
  );
}
