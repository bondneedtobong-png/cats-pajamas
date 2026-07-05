import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BAR_MENU } from './barMenuData.js';
import { CategoryCard } from './MenuCard.jsx';
import './barmenu.css';

// Барная карта (/menu) — перенос бумажного меню в текст (SEO, 2026-07-05).
// Дизайн повторяет бумажные карточки: тёмная страница с тонкой золотой рамкой,
// орнамент-веер сверху/снизу, курсивные заголовки, «объём …… цена» с пунктирным
// лидером, афоризмы с рукописной подписью. Только текст и SVG — без растровых
// картинок меню. Отдельная страница, а не книга: 26 карточек в полноэкранную
// страницу-разворот не помещаются, а здесь у меню свой URL и обычный скролл.

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
        <h1 className="bmn-header__title">БАРНАЯ КАРТА</h1>
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
