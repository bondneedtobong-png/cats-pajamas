import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildBook, buildNav, spreadOfPage } from './bookSpreads.js';
import './menubook.css';

// Секция «Меню» как настоящая книга бара: закрытая обложка (тёмно-фиолетовый
// бумвинил + слепое тиснение знаком), по клику — переворот обложки и книга
// уезжает к центру, дальше ОДНА непрерывная книга по всей карте: развороты
// идут подряд, категория при длинном списке занимает несколько разворотов.
// Референс — логобук, стр. 43–44 («Меню основное»): кремовая льняная бумага,
// ЧЁРНЫЙ текст (осознанное исключение из тёмной темы сайта ради читаемости),
// золотисто-серые арт-деко рамки с веерами, заголовок раздела капителью
// Baskerville, «объём ⋯⋯ цена» с пунктирным лидером.
//
// Пузыри слева НЕ часть книги: это самостоятельные плавающие элементы —
// быстрый переход к разделу (клик → книга перелистывает к его первому
// развороту). Обычное листание — стрелки и клик по левому/правому листу.
//
// Движение: только transform/opacity; всё бесконечное здесь запрещено
// (правило проекта), анимации разовые и выключаются при prefers-reduced-motion.

/* ── Знак «Пижама кота» для тиснения на обложке ──────────────────────────────
   Форма — из бренд-файла «Логотип без текста/svg/Пижама кота_знак_темный на
   прозрачном фоне.svg» (единственный path). Красим почти в цвет обложки: на
   фото логобука тиснение видно только на свету, а не как яркий логотип. */
const MARK_PATH = 'M560.4,234.13c-0.04-1.23-0.18-2.31-1.08-3.23c-0.19-0.19-0.41-0.35-0.62-0.52c-3.91-3.21-8.7-5.31-13.35-7.19c-10.86-4.38-22.44-6.97-33.95-8.94c-21.18-3.62-42.71-5.04-64.17-5.5c-26.81-0.58-53.76,0.1-80.46,2.71c-16.25,1.59-32.56,3.85-48.37,8.02c-7.64,2.02-15.37,4.46-22.38,8.18c-1.29,0.68-2.55,1.42-3.72,2.28c-0.42,0.31-0.89,0.6-1.25,0.98c-1.15,1.19-1.08,2.75-1.07,4.29c0.02,3.39,0.33,6.77,0.8,10.13c3.77,26.5,21.09,48.42,42.61,63.31c10.56,7.31,22.05,12.98,33.57,18.59c9.98,4.86,20.16,9.88,28.88,16.83c9.11,7.26,16.2,16.47,19.7,27.67c4.33,13.89,4.38,28.95,5,43.37c1.34,31.27,1.27,62.59,0.98,93.88c-0.14,15.01,0.42,30.31-1.57,45.23c-1.59,11.89-5.5,23.26-12.08,33.31c-11.56,17.68-29.98,29.57-49.09,37.76c-9.22,3.95-18.81,7.05-28.5,9.66c-1.82,0.49-2.94,2.49-2.44,4.3c0.55,2.01,2.43,2.72,4.3,2.44c0.47-0.07,0.94-0.13,1.4-0.2c0.5-0.07,1.01-0.14,1.51-0.21c0.11-0.01,0.24-0.03,0.42-0.06c0.43-0.06,0.85-0.11,1.27-0.17c4.77-0.62,9.56-1.19,14.34-1.72c15.07-1.67,30.19-2.95,45.34-3.7c32.98-1.63,65.97,0.33,98.8,3.55c7.78,0.76,15.56,1.58,23.32,2.56c0.21,0.04,0.41,0.07,0.61,0.07c0,0,0,0,0.01,0c1.88,0.24,3.5-1.78,3.5-3.5c0-0.6-0.14-1.11-0.38-1.56c-0.36-0.82-1.06-1.51-2.19-1.82c-20.2-5.46-40.2-13.18-57.04-25.84c-8.26-6.21-15.63-13.81-21.17-22.55c-6.42-10.14-10.16-21.58-11.59-33.47c-1.83-15.13-1.31-30.59-1.45-45.8c-0.14-15.58-0.22-31.17-0.09-46.75c0.13-15.72,0.47-31.43,1.17-47.13c0.64-14.24,0.75-29.09,5.27-42.75c7.49-22.64,28.94-34.06,49.05-43.82c23.55-11.44,46.84-24.52,61.75-46.83c7.27-10.87,12.18-23.31,13.84-36.3C560.22,240.54,560.49,237.32,560.4,234.13z M335.03,641.29C334.79,641.32,334.82,641.32,335.03,641.29L335.03,641.29z';

// Позиций на страницу — по ширине экрана (на узком листе их физически меньше).
// Считаем это же число в раскладке, поэтому пагинация и вёрстка не расходятся.
function perPageFor(width) {
  if (width >= 1280) return 6;
  if (width >= 1000) return 5;
  return 4;
}

const FLIP_MS = 420;   // полный переворот листа
const FLIP_FAST = 260; // «пролистывание» при прыжке по пузырю
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Орнаменты страницы (те же веера, что на карточках /menu) ─────────────── */

function PageFan({ flip = false }) {
  const rays = [];
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI * i) / 8;
    rays.push(<line key={i} x1="44" y1="42" x2={(44 - 36 * Math.cos(a)).toFixed(1)} y2={(42 - 36 * Math.sin(a)).toFixed(1)} />);
  }
  return (
    <svg className={`mbook__fan${flip ? ' mbook__fan--flip' : ''}`} viewBox="0 0 88 44" width="52" height="26"
      aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
      {rays}
      <path d="M8 42 A36 36 0 0 1 80 42" />
      <path d="M32 42 A12 12 0 0 1 56 42" fill="var(--mbook-page)" />
    </svg>
  );
}

function PageCorner() {
  const rays = [];
  for (let i = 0; i <= 3; i++) {
    const a = (Math.PI / 2) * (i / 3);
    rays.push(<line key={i} x1="2" y1="2" x2={(2 + 26 * Math.cos(a)).toFixed(1)} y2={(2 + 26 * Math.sin(a)).toFixed(1)} />);
  }
  return (
    <svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2">
      {rays}
      <path d="M28 2 A26 26 0 0 1 2 28" />
    </svg>
  );
}

/** Рамка листа: двойная линия, уголки-веера и веер-медальон сверху/снизу. */
function PageFrame() {
  return (
    <span className="mbook__frame" aria-hidden="true">
      <span className="mbook__corner mbook__corner--tl"><PageCorner /></span>
      <span className="mbook__corner mbook__corner--tr"><PageCorner /></span>
      <span className="mbook__corner mbook__corner--bl"><PageCorner /></span>
      <span className="mbook__corner mbook__corner--br"><PageCorner /></span>
      <span className="mbook__medallion mbook__medallion--top"><PageFan flip /></span>
      <span className="mbook__medallion mbook__medallion--bottom"><PageFan /></span>
    </span>
  );
}

/* ── Лист книги ──────────────────────────────────────────────────────────── */

function BookPage({ page, side }) {
  if (!page) {
    return (
      <div className={`mbook__paper mbook__paper--${side} mbook__paper--blank`} aria-hidden="true">
        <PageFrame />
      </div>
    );
  }
  return (
    <div className={`mbook__paper mbook__paper--${side}`}>
      <PageFrame />
      <div className="mbook__content">
        {page.head ? (
          <header className="mbook__head">
            {page.parent && <p className="mbook__parent">{page.parent}</p>}
            <h3 className="mbook__title">{page.title}</h3>
            {page.unit && <p className="mbook__unit">{page.unit}</p>}
          </header>
        ) : (
          <p className="mbook__cont">{page.title} · продолжение</p>
        )}

        {page.story && <p className="mbook__story">{page.story}</p>}

        <ul className="mbook__items">
          {page.items.map((item) => (
            <li className="mbook__item" key={item.name + item.price}>
              <span className="mbook__item-name">{item.name}</span>
              {item.origin && <span className="mbook__item-origin">{item.origin}</span>}
              <span className="mbook__item-line">
                <span className="mbook__item-vol">{item.volume ?? page.unit ?? ''}</span>
                <span className="mbook__item-leader" aria-hidden="true" />
                <span className="mbook__item-price">{item.price}</span>
              </span>
            </li>
          ))}
        </ul>

        {page.quote && (
          <figure className="mbook__quote">
            <blockquote className="mbook__quote-text">«{page.quote.text}»</blockquote>
            <figcaption className="mbook__quote-sign">{page.quote.author}</figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}

/* ── Книга целиком ───────────────────────────────────────────────────────── */

export default function MenuBook({ menu, stories, printLink }) {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  const [closed, setClosed] = useState(true);
  const [spread, setSpread] = useState(0);
  const [flip, setFlip] = useState(null); // { dir, id, front, back, frozen }
  const busy = useRef(false);
  const pending = useRef(null); // цель, если по книге кликнули во время переворота
  const at = useRef(0);         // текущий разворот без ожидания ре-рендера
  const alive = useRef(true);
  const navRef = useRef(null);

  // Флаг «компонент ещё жив» для асинхронной анимации. Ставим его В эффекте,
  // а не только снимаем в его уборке: в StrictMode эффект монтируется дважды
  // (mount → cleanup → mount), и без переустановки флага книга после первого
  // же переворота считала бы себя размонтированной и не долистывала прыжок.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const perPage = perPageFor(width);
  const { spreads, jumps } = useMemo(() => buildBook(menu, stories, perPage), [menu, stories, perPage]);
  const nav = useMemo(() => buildNav(menu), [menu]);
  const last = Math.max(0, spreads.length - 1);

  // Пересчёт раскладки при смене вьюпорта не должен выкидывать читателя в
  // начало книги: держимся в границах.
  useEffect(() => {
    setSpread((s) => {
      const next = Math.min(s, Math.max(0, spreads.length - 1));
      at.current = next;
      return next;
    });
  }, [spreads.length]);

  const reduced = () => typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Один переворот листа: вперёд — правый лист уходит влево, назад — наоборот. */
  const turn = useCallback(async (from, to, ms) => {
    const dir = to > from ? 'fwd' : 'back';
    const cur = spreads[from] || [null, null];
    const next = spreads[to] || [null, null];
    setFlip({
      id: `${from}-${to}-${Date.now()}`,
      dir,
      ms,
      // Лицо листа — то, что уезжает; изнанка — то, что приезжает на его место.
      front: dir === 'fwd' ? cur[1] : cur[0],
      back: dir === 'fwd' ? next[0] : next[1],
      // Половина, которая под листом ещё не должна смениться.
      frozen: dir === 'fwd' ? { side: 'left', page: cur[0] } : { side: 'right', page: cur[1] },
    });
    setSpread(to);
    at.current = to;
    await wait(ms);
    if (alive.current) setFlip(null);
  }, [spreads]);

  /** Переход к развороту: соседний — один переворот, дальний — быстрая пролистка. */
  const goTo = useCallback(async (target) => {
    const clamp = (n) => Math.max(0, Math.min(last, n));
    let to = clamp(target);
    if (to === at.current) return;
    if (reduced()) { at.current = to; setSpread(to); return; }
    // Кликнули, пока лист ещё летит: не глотаем клик, а запоминаем цель и
    // доводим книгу до неё сразу после текущего переворота.
    if (busy.current) { pending.current = to; return; }

    busy.current = true;
    while (to !== null) {
      const from = at.current;
      const dist = Math.abs(to - from);
      if (dist === 1) {
        await turn(from, to, FLIP_MS);
      } else if (dist > 1) {
        // Прыжок по пузырю: два быстрых переворота — «книгу пролистнули»,
        // а не мгновенно подменили разворот.
        const mid = to - (to > from ? 1 : -1);
        await turn(from, mid, FLIP_FAST);
        if (!alive.current) break;
        await turn(mid, to, FLIP_FAST);
      }
      if (!alive.current) break;
      const next = pending.current;
      pending.current = null;
      to = next !== null && next !== undefined && next !== at.current ? clamp(next) : null;
    }
    busy.current = false;
  }, [last, turn]);

  const open = () => {
    setClosed(false);
    at.current = 0;
    setSpread(0);
  };

  // Стрелки клавиатуры листают книгу, когда фокус внутри неё.
  const onKeyDown = (e) => {
    if (closed) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(spread + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(spread - 1); }
  };

  // Пузырь открытого раздела подтягиваем в видимую часть списка: на десктопе
  // колонка длиннее книги, на телефоне это горизонтальный ряд чипов.
  useEffect(() => {
    const nav = navRef.current;
    const el = nav && nav.querySelector('.is-open');
    if (!nav || !el) return;
    const n = nav.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    const smooth = reduced() ? 'auto' : 'smooth';
    if (nav.scrollWidth > nav.clientWidth + 1) {
      nav.scrollTo({ left: nav.scrollLeft + (e.left + e.width / 2) - (n.left + n.width / 2), behavior: smooth });
    } else if (nav.scrollHeight > nav.clientHeight + 1) {
      nav.scrollTo({ top: nav.scrollTop + (e.top + e.height / 2) - (n.top + n.height / 2), behavior: smooth });
    }
  }, [spread, closed]);

  const cur = spreads[spread] || [null, null];
  const leftPage = flip?.frozen.side === 'left' ? flip.frozen.page : cur[0];
  const rightPage = flip?.frozen.side === 'right' ? flip.frozen.page : cur[1];

  const jumpTo = (key) => {
    const page = jumps.get(key);
    if (page === undefined) return;
    if (closed) setClosed(false);
    goTo(spreadOfPage(page));
  };

  // Подсветка активного пузыря: какие разделы лежат на открытом развороте.
  const openTitles = new Set([leftPage?.title, rightPage?.title].filter(Boolean));

  return (
    <div className={`mbook${closed ? ' mbook--closed' : ''}`} onKeyDown={onKeyDown}>
      {/* Пузыри — самостоятельные плавающие элементы слева, без рамки и подложки */}
      <nav className="mbook__bubbles" ref={navRef} aria-label="Быстрый переход по разделам меню">
        <p className="mbook__bubbles-title">Что вы ищете?</p>
        {nav.map((group) => (
          <div className="mbook__bubble-group" key={group.id}>
            <p className="mbook__bubbles-label">{group.title}</p>
            {group.entries.map((entry) => (
              entry.type === 'parent' ? (
                <div className="mbook__bubble-nest" key={entry.key}>
                  <button
                    type="button"
                    className="mbook__bubble mbook__bubble--parent"
                    onClick={() => jumpTo(entry.key)}
                  >
                    {entry.title}
                  </button>
                  <div className="mbook__bubble-kids">
                    {entry.children.map((kid) => (
                      <button
                        type="button"
                        key={kid.key}
                        className={`mbook__bubble mbook__bubble--kid${openTitles.has(kid.title) ? ' is-open' : ''}`}
                        onClick={() => jumpTo(kid.key)}
                      >
                        {kid.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  key={entry.key}
                  className={`mbook__bubble${openTitles.has(entry.title) ? ' is-open' : ''}`}
                  onClick={() => jumpTo(entry.key)}
                >
                  {entry.title}
                </button>
              )
            ))}
          </div>
        ))}
      </nav>

      <div className="mbook__stage">
        <button
          type="button" className="mbook__arrow mbook__arrow--prev"
          onClick={() => goTo(spread - 1)} disabled={closed || spread === 0}
          aria-label="Предыдущий разворот"
        >‹</button>

        <div className="mbook__book">
          <div className="mbook__spread">
            <button
              type="button" className="mbook__side mbook__side--left"
              onClick={() => goTo(spread - 1)} disabled={closed || spread === 0}
              aria-label="Предыдущий разворот" tabIndex={-1}
            >
              <BookPage page={leftPage} side="left" />
            </button>
            <span className="mbook__spine" aria-hidden="true" />
            <button
              type="button" className="mbook__side mbook__side--right"
              onClick={() => goTo(spread + 1)} disabled={closed || spread === last}
              aria-label="Следующий разворот" tabIndex={-1}
            >
              <BookPage page={rightPage} side="right" />
            </button>

            {flip && (
              <div
                key={flip.id}
                className={`mbook__leaf mbook__leaf--${flip.dir}`}
                style={{ '--mbook-flip': `${flip.ms}ms` }}
                aria-hidden="true"
              >
                <div className="mbook__leaf-face mbook__leaf-face--front">
                  <BookPage page={flip.front} side={flip.dir === 'fwd' ? 'right' : 'left'} />
                </div>
                <div className="mbook__leaf-face mbook__leaf-face--back">
                  <BookPage page={flip.back} side={flip.dir === 'fwd' ? 'left' : 'right'} />
                </div>
              </div>
            )}
          </div>

          {/* Обложка: бумвинил + слепое тиснение знаком. Закрыта — вся книга,
              открыта — уехала налево за корешок. */}
          <button
            type="button" className="mbook__cover" onClick={open}
            tabIndex={closed ? 0 : -1} aria-hidden={!closed}
            aria-label="Открыть меню"
          >
            <span className="mbook__cover-emboss" aria-hidden="true">
              <svg viewBox="0 0 850.39 850.39" width="150" height="150">
                <path d={MARK_PATH} />
              </svg>
            </span>
            <span className="mbook__cover-hint">Меню</span>
          </button>
        </div>

        <button
          type="button" className="mbook__arrow mbook__arrow--next"
          onClick={() => goTo(spread + 1)} disabled={closed || spread === last}
          aria-label="Следующий разворот"
        >›</button>
      </div>

      <div className="mbook__foot">
        <span className="mbook__pager">
          {closed ? 'Книга закрыта' : `Разворот ${spread + 1} из ${spreads.length}`}
        </span>
        {printLink && <a className="mbook__print u-glare" href="/menu">{printLink} ›</a>}
      </div>
    </div>
  );
}
