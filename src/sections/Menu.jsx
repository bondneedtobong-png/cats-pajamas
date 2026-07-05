import { Fragment, useState } from 'react';
import { useReveal } from '../useReveal.js';
import { BAR_MENU, CATEGORY_STORIES } from '../menu/barMenuData.js';
import { CategoryCard } from '../menu/MenuCard.jsx';

// Страница книги «Напитки» — интерактивное бар-меню (переделка 2026-07-05 по
// макету владельца): слева вертикальные кнопки категорий (по одной на каждый
// раздел бумажного меню), в центре «разворот» из одной-двух карточек выбранной
// категории, справа — короткая история раздела. Карусель коктейлей из БД
// убрана с этой страницы. Полная карта одной простынёй живёт на /menu
// (пререндерится для SEO) — сюда ведёт мелкая ссылка из панели истории.
// Категории длиннее SPLIT_AT позиций делятся на два листа, как разворот.
const SPLIT_AT = 9;

const FLAT_CATS = BAR_MENU.flatMap(g => g.categories);

export default function Menu({ tx }) {
  const r0 = useReveal(0);
  const r1 = useReveal(100);
  const [activeTitle, setActiveTitle] = useState(FLAT_CATS[0].title);
  const cat = FLAT_CATS.find(c => c.title === activeTitle) || FLAT_CATS[0];
  const story = CATEGORY_STORIES[cat.title] || '';

  const split = cat.items.length > SPLIT_AT;
  const half = Math.ceil(cat.items.length / 2);

  let btnIndex = 0; // сквозной индекс для каскадной анимации появления кнопок

  return (
    <section id="menu" className="menu">
      <div className="menu__inner menu__inner--book">
        <div ref={r0} className="reveal" style={{ textAlign: 'center' }}>
          <span className="sec-label">{tx.menuLabel}</span>
        </div>
        <h2 ref={r1} className="reveal menu__title" style={{ textAlign: 'center' }}>{tx.menuTitle}</h2>

        <div className="mbk">
          {/* Кнопки категорий — по одной на каждый раздел бумажного меню */}
          <nav className="mbk__nav" aria-label="Разделы меню">
            {BAR_MENU.map((group) => (
              <Fragment key={group.id}>
                <span className="mbk__nav-label">{group.title}</span>
                {group.categories.map((c) => (
                  <button
                    key={c.title}
                    type="button"
                    className={`mbk__nav-btn nav__shimmer${c.title === cat.title ? ' mbk__nav-btn--active' : ''}`}
                    style={{ '--i': btnIndex++ }}
                    onClick={() => setActiveTitle(c.title)}
                  >
                    {c.title}
                  </button>
                ))}
              </Fragment>
            ))}
          </nav>

          {/* Разворот: длинная категория раскладывается на два листа */}
          <div className={`mbk__spread${split ? '' : ' mbk__spread--single'}`}>
            {split ? (
              <>
                <CategoryCard cat={{ ...cat, items: cat.items.slice(0, half), quote: null }} />
                <CategoryCard cat={{ ...cat, items: cat.items.slice(half) }} showHead={false} />
              </>
            ) : (
              <CategoryCard cat={cat} />
            )}
          </div>

          {/* Немного истории про выбранный раздел */}
          <aside className="mbk__story">
            <span className="mbk__story-label">{tx.menuStoryLabel}</span>
            <h3 className="mbk__story-title">{cat.title}</h3>
            <p className="mbk__story-text">{story}</p>
            <a className="mbk__story-link" href="/menu">{tx.menuPrintLink} ›</a>
          </aside>
        </div>
      </div>
    </section>
  );
}
