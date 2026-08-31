import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReveal } from '../useReveal.js';
import manifest from '../data/galleryPhotos.generated.json';

// «Стена памяти» — фото бара бесконечно стекают вниз несколькими колонками,
// каждая со своей скоростью. Наводишь курсор на снимок — колонка целиком
// замирает, можно рассмотреть.
//
// Движение — одна CSS-анимация transform на колонку (лента продублирована,
// едет ровно на половину своей высоты и начинает круг заново). Поэтому
// «остановить» — это animation-play-state: paused на hover, а не пересчёт
// позиций в JS; и по той же причине вне экрана лента честно стоит: секция
// получает класс is-offscreen и все анимации замирают.
//
// Список фото не хардкодится: scripts/generate-gallery-manifest.mjs собирает
// его из public/uploads/showcase/ на predev/prebuild. Владелец добавляет и
// убирает снимки в папке, код не трогает.

const PHOTOS = Array.isArray(manifest?.photos) ? manifest.photos : [];

// Скорость дрейфа, пикселей в секунду — одна на все колонки (просьба
// владельца: как у самой быстрой из прежнего разнобоя).
const SPEED = 37;

// Колонки по размеру экрана. Снимки нужны мелкие (просьба владельца), поэтому
// колонок много: на 1920 плитка выходит ~250px. Брейкпоинт бургер-меню (900px)
// не трогаем — он про шапку, здесь свои пороги.
//
// Высота тоже участвует: в кадр должны попадать минимум два снимка по
// вертикали, а на коротком ноуте (1366×700) полоса физически не выше 620px.
// Значит плитку надо сузить — добавляем колонку, вертикальный кадр становится
// ниже, и два помещаются.
function columnsFor(width, height) {
  let cols;
  if (width < 480) cols = 2;
  else if (width < 760) cols = 3;
  else if (width < 1100) cols = 4;
  else if (width < 1500) cols = 5;
  else if (width < 1800) cols = 6;
  else cols = 7;

  if (height < 820 && width >= 760) cols += 1;
  if (height < 700 && width >= 1100) cols += 1;
  return cols;
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const isPortrait = (p) => p.h >= p.w;

/**
 * Раскладка по колонкам. Три требования владельца сразу:
 *  • горизонтальные и вертикальные кадры чередуются;
 *  • колонки выглядят симметрично друг с другом;
 *  • одинаковые сюжеты (тег = один человек/вечер на нескольких кадрах) не
 *    стоят в колонке подряд.
 *
 * Строго через один чередовать нельзя: в папке 36 вертикальных кадров и 11
 * горизонтальных. Поэтому горизонтальные раскладываем по колонке РОВНЫМИ
 * интервалами (получается «каждый третий-четвёртый»), а у соседних колонок
 * сдвигаем фазу — тогда широкие кадры идут по стене диагональю, а не одной
 * строкой. Это и читается как симметричное чередование.
 */
function buildColumns(photos, columnCount) {
  const portrait = shuffle(photos.filter(isPortrait));
  const landscape = shuffle(photos.filter((p) => !isPortrait(p)));

  // Раздаём обе стопки по колонкам поровну, чтобы широкие кадры не осели в
  // одной-двух колонках.
  const share = Array.from({ length: columnCount }, () => ({ p: [], l: [] }));
  portrait.forEach((ph, i) => share[i % columnCount].p.push(ph));
  landscape.forEach((ph, i) => share[i % columnCount].l.push(ph));

  return share.map(({ p: cp, l: cl }, ci) => {
    const total = cp.length + cl.length;
    const col = new Array(total).fill(null);

    // Слоты для горизонтальных: равные интервалы + фаза колонки.
    if (cl.length) {
      const step = total / cl.length;
      cl.forEach((ph, j) => {
        let slot = Math.round(j * step + (ci % 2 === 0 ? 0 : step / 2)) % total;
        while (col[slot]) slot = (slot + 1) % total; // занято — берём следующий
        col[slot] = ph;
      });
    }
    // Остальное — вертикальные, по порядку.
    let k = 0;
    for (let i = 0; i < total; i++) if (!col[i]) col[i] = cp[k++];

    // Разводим одинаковые теги — меняемся только с кадром той же ориентации,
    // иначе сломается только что выстроенный ритм.
    for (let i = 1; i < col.length; i++) {
      if (!col[i] || !col[i - 1] || col[i].tag !== col[i - 1].tag) continue;
      const swapAt = col.findIndex((ph, j) =>
        j > i && ph && ph.tag !== col[i - 1].tag && isPortrait(ph) === isPortrait(col[i]));
      if (swapAt > i) [col[i], col[swapAt]] = [col[swapAt], col[i]];
    }
    return col.filter(Boolean);
  });
}

export default function Wall({ tx }) {
  const [columnCount, setColumnCount] = useState(() => (typeof window === 'undefined' ? 5 : columnsFor(window.innerWidth, window.innerHeight)));
  const sectionRef = useRef(null);
  const gridRef = useRef(null);
  const trackRefs = useRef([]);
  const colRefs = useRef([]);
  // Что сейчас под курсором: колонка (её лента стоит) и конкретный снимок
  // (он подсвечен). Держим в state, а не в CSS :hover — см. onPointerMove.
  const [hot, setHot] = useState({ col: -1, key: '' });
  const r0 = useReveal(0);
  const r1 = useReveal(100);

  useEffect(() => {
    const onResize = () => setColumnCount(columnsFor(window.innerWidth, window.innerHeight));
    onResize();
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Порядок фото фиксируем на жизнь компонента: иначе стена перетасовывалась бы
  // при каждом повороте телефона.
  const pool = useMemo(() => shuffle(PHOTOS), []);
  const columns = useMemo(() => buildColumns(pool, columnCount), [pool, columnCount]);

  // Длительность круга считаем из реальной высоты ленты: снимки разной
  // пропорции, фиксированной высоты у колонки нет. Пиксели в секунду — общие,
  // поэтому длинная колонка едет дольше, а скорость на глаз одинаковая.
  useLayoutEffect(() => {
    const measure = () => {
      trackRefs.current.forEach((track) => {
        if (!track) return;
        const loop = track.scrollHeight / 2; // лента продублирована
        track.style.setProperty('--dur', `${Math.max(12, loop / SPEED).toFixed(1)}s`);
      });
    };
    measure();
    // Картинки догружаются и высота ленты растёт — пересчитываем.
    const ro = new ResizeObserver(measure);
    trackRefs.current.forEach((t) => t && ro.observe(t));
    return () => ro.disconnect();
  }, [columns]);

  // Наведение считаем сами, а не через CSS :hover на колонке. У :hover две
  // дыры, обе владелец и поймал: между колонками и между снимками есть зазоры,
  // и курсор, ведомый вдоль стены, постоянно проваливается в них — лента
  // дёргается «стоп-поехали». Здесь колонка считается по X курсора, поэтому
  // остаётся замершей, пока курсор в её полосе, даже если он между кадрами.
  // Подсветка при этом честно привязана к конкретному снимку под курсором.
  const onPointerMove = (e) => {
    if (e.pointerType === 'touch') return; // на тач-экране «наведения» нет
    const x = e.clientX;
    const col = colRefs.current.findIndex((el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right;
    });
    const fig = e.target.closest?.('.wall__item');
    const key = fig?.dataset.key || '';
    setHot((prev) => (prev.col === col && prev.key === key ? prev : { col, key }));
  };
  const onPointerLeave = () => setHot({ col: -1, key: '' });

  // Вне экрана лента стоит: бесконечная анимация не должна жечь батарею,
  // пока секции не видно.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !PHOTOS.length) return;
    const io = new IntersectionObserver(
      ([entry]) => section.classList.toggle('is-offscreen', !entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(section);
    return () => io.disconnect();
  }, []);

  // Фото нет вовсе (папка пуста / манифест не собран) — секции просто нет.
  if (!PHOTOS.length) return null;

  return (
    <section id="wall" className="wall" ref={sectionRef}>
      <div className="wall__inner">
        <div ref={r0} className="reveal mb-10 chapter-glow" style={{ textAlign: 'center' }}>
          <span className="sec-label">{tx.wallLabel}</span>
        </div>
        <h2 ref={r1} className="reveal wall__title">{tx.wallTitle}</h2>
      </div>

      <div
        className="wall__grid"
        ref={gridRef}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        {columns.map((col, ci) => (
          <div key={ci} className="wall__col" ref={(el) => { colRefs.current[ci] = el; }}>
            <div
              className={`wall__track${hot.col === ci ? ' wall__track--paused' : ''}`}
              ref={(el) => { trackRefs.current[ci] = el; }}
            >
              {/* Лента продублирована — на этом держится бесшовный круг:
                  сдвиг ровно на половину высоты возвращает картинку в исходную. */}
              {[...col, ...col].map((p, i) => {
                const key = `${p.src}-${i}`;
                return (
                <figure
                  key={key}
                  data-key={key}
                  className={`wall__item${hot.key === key ? ' wall__item--hot' : ''}`}
                  style={{ aspectRatio: `${p.w} / ${p.h}` }}
                >
                  <img
                    src={p.src}
                    srcSet={p.srcSm ? `${p.srcSm} 480w, ${p.src} 900w` : undefined}
                    sizes="(max-width: 480px) 46vw, (max-width: 1100px) 30vw, 16vw"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={p.w}
                    height={p.h}
                    draggable="false"
                  />
                </figure>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
