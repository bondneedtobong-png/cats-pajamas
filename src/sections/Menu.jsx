import { useState, useEffect, lazy, Suspense } from 'react';
import { useReveal } from '../useReveal.js';
import { BAR_MENU, CATEGORY_STORIES } from '../menu/barMenuData.js';
import BarMenuService from '../menu/BarMenuService.js';
import AuthService from '../auth/AuthService.js';
import MenuBook from '../menu/MenuBook.jsx';
import '../menu/barmenu-editor.css'; // стили кнопки/редактора — грузим сразу (крошечные), чтобы кнопка не была без стиля до первого открытия

// Редактор нужен только админам — грузим его JS-чанк лениво, при открытии,
// чтобы не тащить логику правки в бандл лендинга для обычных гостей.
const MenuInlineEditor = lazy(() => import('../menu/MenuInlineEditor.jsx'));

// Секция «Меню» — барная карта как настоящая книга бара (переделка 2026-08-23
// по логобуку, стр. 43–44): закрытая обложка → разворот на два листа →
// непрерывное листание по всей карте. Сама книга и её навигация-пузыри живут
// в MenuBook.jsx, раскладка по страницам — в menu/bookSpreads.js.
// Ссылка «Открыть карту отдельной страницей» убрана 2026-08-29 по ТЗ владельца.
// Сам маршрут /menu жив, но с сайта на него больше не ведёт ничего: это
// SEO-пререндер (dist/menu/index.html со всем текстом карты и JSON-LD), он
// в sitemap.xml и проиндексирован. Сносить его — отдельное решение владельца.

export default function Menu({ tx }) {
  const r0 = useReveal(0);
  const r1 = useReveal(100);
  // Инициализируемся статикой (мгновенный рендер, ноль мигания) и подменяем на
  // карту из БД, когда она приедет. При недоступном API остаётся статика.
  const [menu, setMenu] = useState(BAR_MENU);
  const [stories, setStories] = useState(CATEGORY_STORIES);
  const [editing, setEditing] = useState(false);
  const isAdmin = AuthService.isAdmin();

  useEffect(() => {
    let alive = true;
    BarMenuService.getPublic().then((d) => {
      if (alive) { setMenu(d.menu); setStories(d.stories); }
    });
    return () => { alive = false; };
  }, []);

  return (
    <section id="menu" className="menu">
      <div className="brand-bottles" />
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

            <MenuBook menu={menu} stories={stories} />
          </>
        )}
      </div>
    </section>
  );
}
