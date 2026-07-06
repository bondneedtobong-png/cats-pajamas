import { Fragment, useState, useEffect, lazy, Suspense } from 'react';
import { useReveal } from '../useReveal.js';
import { BAR_MENU, CATEGORY_STORIES } from '../menu/barMenuData.js';
import BarMenuService from '../menu/BarMenuService.js';
import AuthService from '../auth/AuthService.js';
import { CategoryCard } from '../menu/MenuCard.jsx';
import '../menu/barmenu-editor.css'; // стили кнопки/редактора — грузим сразу (крошечные), чтобы кнопка не была без стиля до первого открытия

// Редактор нужен только админам — грузим его JS-чанк лениво, при открытии,
// чтобы не тащить логику правки в бандл лендинга для обычных гостей.
const MenuInlineEditor = lazy(() => import('../menu/MenuInlineEditor.jsx'));

// Страница книги «Напитки» — интерактивное бар-меню (переделка 2026-07-05 по
// макету владельца): слева вертикальные кнопки категорий (по одной на каждый
// раздел бумажного меню), в центре «разворот» из одной-двух карточек выбранной
// категории, справа — короткая история раздела. Карусель коктейлей из БД
// убрана с этой страницы. Полная карта одной простынёй живёт на /menu
// (пререндерится для SEO) — сюда ведёт мелкая ссылка из панели истории.
// Категории длиннее SPLIT_AT позиций делятся на два листа, как разворот.
const SPLIT_AT = 9;

export default function Menu({ tx }) {
  const r0 = useReveal(0);
  const r1 = useReveal(100);
  // Инициализируемся статикой (мгновенный рендер, ноль мигания) и подменяем на
  // карту из БД, когда она приедет. При недоступном API остаётся статика.
  const [menu, setMenu] = useState(BAR_MENU);
  const [stories, setStories] = useState(CATEGORY_STORIES);
  const [activeTitle, setActiveTitle] = useState(BAR_MENU[0].categories[0].title);
  const [editing, setEditing] = useState(false);
  const isAdmin = AuthService.isAdmin();

  useEffect(() => {
    let alive = true;
    BarMenuService.getPublic().then((d) => {
      if (alive) { setMenu(d.menu); setStories(d.stories); }
    });
    return () => { alive = false; };
  }, []);

  const flatCats = menu.flatMap(g => g.categories);
  const cat = flatCats.find(c => c.title === activeTitle) || flatCats[0];
  const story = stories[cat.title] || '';

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

        {editing ? (
          <Suspense fallback={<div className="mbk-edit-emptyspread">Загрузка редактора…</div>}>
            <MenuInlineEditor
              initial={{ menu, stories }}
              onCancel={() => setEditing(false)}
              onSaved={(saved) => {
                setMenu(saved.menu);
                setStories(saved.stories);
                setEditing(false);
              }}
            />
          </Suspense>
        ) : (
          <>
            {isAdmin && (
              <div style={{ textAlign: 'center' }}>
                <button className="mbk-edit-btn" type="button" onClick={() => setEditing(true)}>
                  ✏️ Редактировать карту
                </button>
              </div>
            )}

            <div className="mbk">
              {/* Кнопки категорий — по одной на каждый раздел бумажного меню */}
              <nav className="mbk__nav" aria-label="Разделы меню">
                {menu.map((group) => (
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
          </>
        )}
      </div>
    </section>
  );
}
