import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BAR_MENU } from './barMenuData.js';
import './barmenu.css';

// Барная карта (/menu) — перенос бумажного меню в текст (SEO, 2026-07-05).
// Дизайн повторяет бумажные карточки: тёмная страница с тонкой золотой рамкой,
// орнамент-веер сверху/снизу, курсивные заголовки, «объём …… цена» с пунктирным
// лидером, афоризмы с рукописной подписью. Только текст и SVG — без растровых
// картинок меню. Отдельная страница, а не книга: 26 карточек в полноэкранную
// страницу-разворот не помещаются, а здесь у меню свой URL и обычный скролл.

// Веер-орнамент (ар-деко) — верх/низ карточки. Чисто декоративный.
function Fan({ flip = false }) {
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

// Четверть-веер в углах рамки (позиционируется/зеркалится через CSS)
function CornerFan() {
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

function CategoryCard({ cat }) {
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

        <h3 className="bmn-card__title">{cat.title}</h3>
        {cat.unit && <p className="bmn-card__unit">{cat.unit}</p>}

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

export default function BarMenuPage() {
  // Мета per-route (title/description/canonical) — для ботов, исполняющих JS;
  // основной SEO-путь — статический пререндер dist/menu/index.html при сборке
  // (scripts/prerender-menu.mjs), там та же мета зашита в сырой HTML.
  useEffect(() => {
    const prevTitle = document.title;
    const desc = document.querySelector('meta[name="description"]');
    const canonical = document.querySelector('link[rel="canonical"]');
    const prevDesc = desc?.getAttribute('content');
    const prevCanonical = canonical?.getAttribute('href');
    document.title = "Барная карта — The Cat's Pajamas Club, джаз-бар в Самаре";
    desc?.setAttribute('content', 'Полное меню бара: авторские коктейли, вина, виски, ром, джин, настойки и закуски. Джаз-бар The Cat\'s Pajamas Club, Самара.');
    canonical?.setAttribute('href', 'https://cats-pajamas.ru/menu/');
    return () => {
      document.title = prevTitle;
      if (prevDesc) desc?.setAttribute('content', prevDesc);
      if (prevCanonical) canonical?.setAttribute('href', prevCanonical);
    };
  }, []);

  const scrollTo = (id) => (e) => {
    e.preventDefault();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(`bmn-${id}`)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <div className="bmn-root">
      <header className="bmn-header">
        <Link to="/" className="bmn-header__logo">
          <img src="/uploads/logo-icon.svg" alt="" style={{ height: 24, width: 'auto', display: 'block' }} />
          <span className="bmn-header__logo-text">CAT'S PAJAMAS</span>
        </Link>
        <div className="bmn-header__divider" />
        <span className="bmn-header__title">БАРНАЯ КАРТА</span>
        <div style={{ flex: 1 }} />
        <Link to="/" className="bmn-header__back">← На сайт</Link>
      </header>

      <nav className="bmn-nav" aria-label="Разделы меню">
        {BAR_MENU.map((group) => (
          <a key={group.id} className="bmn-nav__chip" href={`#bmn-${group.id}`} onClick={scrollTo(group.id)}>
            {group.title}
          </a>
        ))}
      </nav>

      <main className="bmn-main">
        {BAR_MENU.map((group) => (
          <section key={group.id} id={`bmn-${group.id}`} className="bmn-group">
            <h2 className="bmn-group__title">{group.title}</h2>
            <div className="bmn-grid">
              {group.categories.map((cat) => (
                <CategoryCard key={cat.title} cat={cat} />
              ))}
            </div>
          </section>
        ))}

        <p className="bmn-footnote">
          Цены действительны на момент публикации — уточняйте у барменов. Чрезмерное употребление алкоголя вредит вашему здоровью.
        </p>
      </main>
    </div>
  );
}
