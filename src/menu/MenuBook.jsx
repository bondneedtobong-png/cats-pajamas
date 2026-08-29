import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildBook, buildNav, spreadOfPage } from './bookSpreads.js';
import MenuShowcase from './MenuShowcase.jsx';
import MenuSticker from './MenuSticker.jsx';
import './menubook.css';

// Секция «Меню» как настоящая книга бара: закрытая обложка (тёмно-фиолетовый
// бумвинил с зерном + слепое тиснение логотипом), по клику — переворот обложки
// и книга уезжает к центру, дальше ОДНА непрерывная книга по всей карте:
// развороты идут подряд, категория при длинном списке занимает несколько
// разворотов. Книга закрывается с ОБОИХ концов: долистал до конца — щёлкнул по
// правому листу, книга захлопнулась задней обложкой; ещё клик — открылась с
// конца. То же в начале: клик по левому листу на первом развороте закрывает
// книгу передней обложкой. Стрелок нет, листаем кликом по листу.
// Референс — логобук, стр. 43–44 («Меню основное»): кремовая льняная бумага,
// ЧЁРНЫЙ текст (осознанное исключение из тёмной темы сайта ради читаемости),
// золотисто-серые арт-деко рамки с веерами, заголовок раздела капителью
// Baskerville, «объём ⋯⋯ цена» с пунктирным лидером.
//
// Пузыри слева НЕ часть книги: самостоятельные плавающие кружки — быстрый
// переход к разделу (клик → книга перелистывает к его первому развороту).
// В пузырях только верхний уровень: у «Виски» один пузырь на весь блок, чтобы
// не перегружать (Шотландия/Ирландия/Америка внутри книги остаются своими
// разворотами). Обычное листание — стрелки и клик по левому/правому листу.
// Справа — витрина коктейлей (MenuShowcase), фото медленно стекают вниз.
//
// Движение: только transform/opacity; всё бесконечное здесь запрещено
// (правило проекта), анимации разовые и выключаются при prefers-reduced-motion.

// Ёмкость листа — по РЕАЛЬНЫМ его размерам. Все формулы ниже дословно
// повторяют menubook.css, поэтому пагинация и вёрстка не расходятся: на
// высоком экране лист длинный и позиций влезает больше, на коротком — меньше.
// ⚠️ Правишь в CSS кегль, поля или межстрочный — поправь и здесь.

/** CSS-clamp(minpx, Nvh, maxpx) в пикселях. */
const cvh = (min, vh, max, height) => Math.min(max, Math.max(min, (height * vh) / 100));
/** То же для vw. */
const cvw = (min, vw, max, width) => Math.min(max, Math.max(min, (width * vw) / 100));

/**
 * Размеры листа на трёх брейкпоинтах книги — зеркало --mbook-page-h /
 * --mbook-fit / --mbook-fs из menubook.css (десктоп, ≤1000px, ≤640px).
 */
function pageBox(width, height) {
  if (width <= 640) {
    return { h: Math.min(380, Math.max(300, height * 0.46)), fit: (width - 26) / 2, fs: 1.12 };
  }
  if (width <= 1000) {
    return { h: Math.min(560, Math.max(360, height * 0.6)), fit: (width - 150) / 2, fs: 1.56 };
  }
  return { h: Math.min(820, Math.max(440, height * 0.84)), fit: (width - 620) / 2, fs: 1.56 };
}
const PAGE_RATIO = 0.6; // --mbook-ratio: лист вытянут по вертикали

/**
 * Высота БАЗОВОЙ позиции: название + состав в ОДНУ строку + строка
 * «объём ⋯ цена». Она же — единица измерения для bookSpreads.js: всё
 * остальное на листе (заголовок, «О разделе», цитата) выражено в её долях.
 */
function baseRow(height, fs) {
  const name   = cvh(10,  1.5,  14,   height) * fs * 1.22;
  const origin = cvh(8.5, 1.15, 11,   height) * fs * 0.86 * 1.28;
  const price  = cvh(9,   1.2,  11.5, height) * fs * 1.25;
  return name + origin + price + 3; // + gap:1px внутри позиции и margin-top строки цены
}

/** Поля листа и отбивка списка — всё, что съедает лист до содержимого.
 *  На телефоне лист втрое короче, поэтому и поля там скромнее (см. медиазапрос
 *  ≤640px в menubook.css). */
const chromeHeight = (width, height) => (width <= 640
  ? cvh(6, 0.9, 10, height) + cvh(7, 1.1, 12, height) + cvh(4, 0.7, 8, height)
  : cvh(11, 1.9, 18, height) + cvh(12, 1.9, 18, height) + cvh(4, 0.7, 8, height));

/**
 * Ёмкость листа в «позициях» и оценка длины строки.
 *
 * Строк в составе и в блоке «О разделе» может быть больше одной — от этого
 * прямо зависит, сколько позиций влезет. Раньше раскладка считала все позиции
 * одинаковыми и по худшему случаю, поэтому низ каждого листа стоял пустым.
 * Теперь длина текста переводится в строки по ширине листа: 0.46em — средняя
 * ширина знака у курсивного Involve, 0.42em — у рукописного Jar Binks
 * (замерено по реальной вёрстке).
 */
function bookMetrics(width, height) {
  const { h: pageH, fit, fs } = pageBox(width, height);
  const pageW = Math.min(pageH * PAGE_RATIO, Math.max(160, fit));
  const inner = Math.max(140, pageW - 2 * cvw(14, 2.2, 26, width));
  const gap = cvh(2, 0.4, 5, height); // .mbook__items { gap }
  const row = baseRow(height, fs) + gap;
  // n строк и (n-1) зазоров должны уместиться в свободную высоту.
  const perPage = Math.max(2, (pageH - chromeHeight(width, height) + gap) / row);
  const originFs = cvh(8.5, 1.15, 11, height) * fs * 0.86;
  const storyFs  = cvh(10, 1.35, 12.5, height) * fs;
  const quoteFs  = cvh(9, 1.2, 11.5, height) * fs;
  return {
    perPage,
    cpl: {
      origin: Math.max(16, inner / (0.46 * originFs)),
      story:  Math.max(14, inner / (0.42 * storyFs)),
      quote:  Math.max(14, inner / (0.46 * quoteFs)),
    },
  };
}

/** Диаметр пузыря под длину названия: короткие — мелкие, длинные — крупнее.
 *  Со стикером кот занимает верхнюю половину кружка, поэтому пузыри крупнее,
 *  чем в текстовой версии. */
function bubbleSize(title) {
  const n = String(title).length;
  if (n <= 5) return 92;
  if (n <= 10) return 104;
  if (n <= 16) return 116;
  return 126;
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

/**
 * Рамка листа: двойная линия и уголки-веера.
 * Медальоны-веера сверху и снизу сняты при уплотнении 2026-08-30: они стояли
 * ровно в вертикальном потоке и требовали крупных полей листа — вдвоём
 * съедали позицию с каждой страницы. Компонент PageFan остался: он рисует и
 * уголки, и медальоны, если их вернут.
 */
function PageFrame() {
  return (
    <span className="mbook__frame" aria-hidden="true">
      <span className="mbook__corner mbook__corner--tl"><PageCorner /></span>
      <span className="mbook__corner mbook__corner--tr"><PageCorner /></span>
      <span className="mbook__corner mbook__corner--bl"><PageCorner /></span>
      <span className="mbook__corner mbook__corner--br"><PageCorner /></span>
    </span>
  );
}

/* ── Лист книги ──────────────────────────────────────────────────────────── */

// Длинное тире в рукописном Jar Binks рендерится жирной чертой и рвёт строку
// (известная беда шрифта, см. CLAUDE.md). «О разделе» теперь набрано именно им,
// а тексты приходят из админки — меняем тире на запятую при выводе.
const handwritten = (s) => String(s || '').replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',');

/** Один раздел на листе. Их на странице может быть несколько — лист набивается
 *  до конца, а не отдаётся одному разделу (см. bookSpreads.js). */
function PageSection({ block }) {
  return (
    <section className="mbook__sec">
      {block.head ? (
        <header className="mbook__head">
          {block.parent && <p className="mbook__parent">{block.parent}</p>}
          <h3 className="mbook__title">{block.title}</h3>
          {block.unit && <p className="mbook__unit">{block.unit}</p>}
        </header>
      ) : (
        <p className="mbook__cont">{block.title} · продолжение</p>
      )}

      {block.story && <p className="mbook__story">{handwritten(block.story)}</p>}

      <ul className="mbook__items">
        {block.items.map((item) => (
          <li className="mbook__item" key={item.name + item.price}>
            <span className="mbook__item-name">{item.name}</span>
            {item.origin && <span className="mbook__item-origin">{item.origin}</span>}
            <span className="mbook__item-line">
              <span className="mbook__item-vol">{item.volume ?? block.unit ?? ''}</span>
              <span className="mbook__item-leader" aria-hidden="true" />
              <span className="mbook__item-price">{item.price}</span>
            </span>
          </li>
        ))}
      </ul>

      {block.quote && (
        <figure className="mbook__quote">
          <blockquote className="mbook__quote-text">«{block.quote.text}»</blockquote>
          <figcaption className="mbook__quote-sign">{block.quote.author}</figcaption>
        </figure>
      )}
    </section>
  );
}

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
        {page.blocks.map((block, i) => (
          <PageSection key={`${block.title}#${i}`} block={block} />
        ))}
      </div>
    </div>
  );
}

/* ── Книга целиком ───────────────────────────────────────────────────────── */

export default function MenuBook({ menu, stories }) {
  const [size, setSize] = useState(() => (typeof window === 'undefined'
    ? { w: 1440, h: 900 }
    : { w: window.innerWidth, h: window.innerHeight }));
  // front — книга закрыта передней обложкой, back — задней (долистали до
  // конца и захлопнули), open — читаем разворот.
  const [mode, setMode] = useState('front');
  const [spread, setSpread] = useState(0);
  const [flip, setFlip] = useState(null); // { dir, id, front, back, frozen }
  const busy = useRef(false);
  const pending = useRef(null); // цель, если по книге кликнули во время переворота
  const at = useRef(0);         // текущий разворот без ожидания ре-рендера
  const alive = useRef(true);
  const navRef = useRef(null);
  const rootRef = useRef(null);

  // Флаг «компонент ещё жив» для асинхронной анимации. Ставим его В эффекте,
  // а не только снимаем в его уборке: в StrictMode эффект монтируется дважды
  // (mount → cleanup → mount), и без переустановки флага книга после первого
  // же переворота считала бы себя размонтированной и не долистывала прыжок.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const { perPage, cpl } = bookMetrics(size.w, size.h);
  const { spreads, jumps } = useMemo(
    () => buildBook(menu, stories, perPage, cpl),
    [menu, stories, perPage, cpl.origin, cpl.story, cpl.quote],
  );
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

  const closed = mode !== 'open';

  /** Открыть книгу на развороте (0 — с начала, last — с конца). */
  const openAt = (i) => {
    const to = Math.max(0, Math.min(last, i));
    at.current = to;
    setSpread(to);
    setMode('open');
  };
  /** Захлопнуть: 'front' — на первом развороте, 'back' — на последнем. */
  const close = (side) => { setFlip(null); setMode(side); };

  // Клик по листу: листаем, а на краях книги — закрываем её с этой стороны.
  const turnLeft = () => (spread === 0 ? close('front') : goTo(spread - 1));
  const turnRight = () => (spread === last ? close('back') : goTo(spread + 1));

  // Стрелки клавиатуры: то же самое, включая закрытие и открытие с краёв.
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const fwd = e.key === 'ArrowRight';
    if (mode === 'front') { if (fwd) openAt(0); return; }
    if (mode === 'back') { if (!fwd) openAt(last); return; }
    (fwd ? turnRight : turnLeft)();
  };

  // Пузыри покачиваются бесконечно — вне экрана ставим на паузу, чтобы не
  // жечь GPU (правило проекта; тот же приём, что в «Стене памяти»).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => root.classList.toggle('is-offscreen', !entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(root);
    return () => io.disconnect();
  }, []);

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
  }, [spread, mode]);

  const cur = spreads[spread] || [null, null];
  const leftPage = flip?.frozen.side === 'left' ? flip.frozen.page : cur[0];
  const rightPage = flip?.frozen.side === 'right' ? flip.frozen.page : cur[1];

  // Пузыри: верхний уровень карты. Надгруппа («Виски») даёт один пузырь на
  // весь блок — её дети живут только внутри книги.
  const bubbles = useMemo(
    () => nav.flatMap((group) => group.entries.map((e) => ({ key: e.key, title: e.title, kids: e.children || [] }))),
    [nav],
  );

  const jumpTo = (key) => {
    const page = jumps.get(key);
    if (page === undefined) return;
    const target = spreadOfPage(page);
    if (closed) { openAt(target); return; }
    goTo(target);
  };

  // Подсветка активного пузыря: какие разделы лежат на открытом развороте.
  // У «Виски» пузырь горит и на разворотах его детей.
  const openTitles = new Set([leftPage?.title, rightPage?.title].filter(Boolean));
  const openKeys = new Set(
    bubbles.filter((b) => openTitles.has(b.title) || b.kids.some((k) => openTitles.has(k.title))).map((b) => b.key),
  );

  return (
    <div className={`mbook mbook--${mode}${closed ? ' mbook--closed' : ''}`} ref={rootRef} onKeyDown={onKeyDown}>
      {/* Пузыри — самостоятельные плавающие элементы слева, без рамки и подложки */}
      <nav className="mbook__bubbles mbook__bubbles--paper" ref={navRef} aria-label="Быстрый переход по разделам меню">
        <p className="mbook__bubbles-title">Что вы ищете?</p>
        <div className="mbook__bubble-field">
          {bubbles.map((bubble, i) => (
            <button
              type="button"
              key={bubble.key}
              className={`mbook__bubble${openKeys.has(bubble.key) ? ' is-open' : ''}`}
              // Размер — от длины названия, смещение и фаза покачивания — от
              // номера: поле пузырей выглядит живым, но раскладка стабильна
              // (никакого Math.random, иначе прыгало бы на каждом ре-рендере).
              style={{
                '--mbook-bubble-size': `${bubbleSize(bubble.title)}px`,
                '--mbook-bubble-shift': `${(i % 3) * 10 - 10}px`,
                '--mbook-bubble-delay': `${(i % 5) * 0.7}s`,
                '--mbook-bubble-dur': `${7 + (i % 4)}s`,
                // Наклон — для «наклеек» и «печатей»: чётные влево, нечётные вправо.
                '--mbook-bubble-tilt': `${((i % 5) - 2) * 2.2}deg`,
              }}
              onClick={() => jumpTo(bubble.key)}
            >
              {/* Два слоя нарочно: на кнопке живёт покачивание (transform), на
                  теле — hover-подъём. Один элемент не может делать оба
                  transform одновременно — анимация перебивает hover. */}
              <span className="mbook__bubble-body">
                {/* Кот в настроении раздела: в покое стоит, на наведении
                    оживает (правило проекта — никаких вечных анимаций). */}
                <MenuSticker title={bubble.title} size={Math.round(bubbleSize(bubble.title) * 0.46)} />
                <span className="mbook__bubble-text">{bubble.title}</span>
              </span>
            </button>
          ))}
        </div>
      </nav>

      <div className="mbook__stage">
        <div className="mbook__book">
          <div className="mbook__spread">
            {/* Листаем кликом по листу; на краях книги тот же клик её
                захлопывает — слева передней обложкой, справа задней. */}
            <button
              type="button" className="mbook__side mbook__side--left"
              onClick={turnLeft} disabled={closed}
              aria-label={spread === 0 ? 'Закрыть меню' : 'Предыдущий разворот'} tabIndex={-1}
            >
              <BookPage page={leftPage} side="left" />
            </button>
            <span className="mbook__spine" aria-hidden="true" />
            <button
              type="button" className="mbook__side mbook__side--right"
              onClick={turnRight} disabled={closed}
              aria-label={spread === last ? 'Закрыть меню' : 'Следующий разворот'} tabIndex={-1}
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

          {/* Передняя обложка: бумвинил с зерном и слепое тиснение логотипом
              (маска /uploads/logo-lockup.svg — тот же локап, что на печатной
              обложке в логобуке). Открыта — легла за левый лист. */}
          <button
            type="button" className="mbook__cover mbook__cover--front"
            onClick={() => openAt(0)}
            tabIndex={mode === 'front' ? 0 : -1} aria-hidden={mode !== 'front'}
            aria-label="Открыть меню"
          >
            <span className="mbook__cover-emboss" aria-hidden="true" />
          </button>

          {/* Задняя обложка: книгу можно долистать до конца и захлопнуть, а
              следующим кликом открыть с конца. */}
          <button
            type="button" className="mbook__cover mbook__cover--back"
            onClick={() => openAt(last)}
            tabIndex={mode === 'back' ? 0 : -1} aria-hidden={mode !== 'back'}
            aria-label="Открыть меню с конца"
          />
        </div>
      </div>

      <MenuShowcase />

      <div className="mbook__foot">
        <span className="mbook__pager">
          {mode === 'front' && 'Нажмите на обложку'}
          {mode === 'back' && 'Конец карты — нажмите, чтобы открыть с конца'}
          {mode === 'open' && `Разворот ${spread + 1} из ${spreads.length}`}
        </span>
      </div>
    </div>
  );
}
