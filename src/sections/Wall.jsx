import { useEffect, useMemo, useRef, useState } from 'react';
import { useReveal } from '../useReveal.js';
import manifest from '../data/galleryPhotos.generated.json';

// «Дрейфующая стена» — россыпь фото бара, которая медленно дрейфует при
// прокрутке. Визуальный референс — Drift Wall с reactbits.dev; тамошний
// компонент бесплатный и без зависимостей, но делает другое: бесконечную
// 3D-карусель с вечным requestAnimationFrame и параллаксом от курсора.
// Здесь нужен дрейф ОТ ПРОКРУТКИ и своя раскладка (перемешивание + разведение
// одинаковых сюжетов), поэтому механика написана своя — заодно ни одного
// лишнего кадра, когда секции нет на экране.
//
// Список фото не хардкодится: scripts/generate-gallery-manifest.mjs собирает
// его из public/uploads/showcase/ на predev/prebuild. Владелец добавляет и
// убирает снимки в папке, код не трогает.

const PHOTOS = Array.isArray(manifest?.photos) ? manifest.photos : [];

// Сколько кадров вешаем на стену. Все 47 не нужны: стена — полоса
// фиксированной высоты, ниже неё фото всё равно обрезаны, а грузить лишние
// мегабайты незачем. Берём с запасом на высокие экраны.
const MAX_ON_WALL = 30;

// Колонки по ширине экрана. Мобильный брейкпоинт (900px) не трогаем — он про
// шапку; здесь свои пороги под раскладку стены.
function columnsFor(width) {
  if (width < 560) return 2;
  if (width < 900) return 3;
  if (width < 1200) return 4;
  if (width < 1600) return 5;
  return 6;
}

// Детерминированный «случайный» угол: одно фото — всегда один и тот же наклон,
// на ресайзе и ре-рендере не скачет (иначе стена дёргалась бы при каждом
// изменении ширины).
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
function tiltFor(src, max) {
  const h = hashString(src);
  return ((h % 1201) / 1200) * (max * 2) - max; // -max…+max
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Раскладка: перемешать → разложить по колонкам round-robin → развести
 * соседей с одинаковым тегом. Тег — это один и тот же человек или сюжет на
 * нескольких кадрах (staff-stripedtie — четыре фото одного бармена), и
 * владелец просил, чтобы такие не стояли в колонке подряд.
 * Если менять не с чем — оставляем как есть: эффект нужен «на глаз».
 */
function buildColumns(photos, columnCount) {
  const cols = Array.from({ length: columnCount }, () => []);
  shuffle(photos).forEach((p, i) => cols[i % columnCount].push(p));

  for (const col of cols) {
    for (let i = 1; i < col.length; i++) {
      if (col[i].tag !== col[i - 1].tag) continue;
      const swapAt = col.findIndex((p, j) => j > i && p.tag !== col[i - 1].tag && (j + 1 >= col.length || col[j + 1].tag !== col[i].tag));
      if (swapAt > i) [col[i], col[swapAt]] = [col[swapAt], col[i]];
    }
  }
  return cols;
}

export default function Wall({ tx }) {
  const [columnCount, setColumnCount] = useState(() => (typeof window === 'undefined' ? 4 : columnsFor(window.innerWidth)));
  const sectionRef = useRef(null);
  const wallRef = useRef(null);
  const r0 = useReveal(0);
  const r1 = useReveal(100);
  const rWall = useReveal(200);

  useEffect(() => {
    const onResize = () => setColumnCount(columnsFor(window.innerWidth));
    onResize();
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Перемешиваем один раз на жизнь компонента: смена числа колонок раскладку
  // пересобирает, но порядок фото берётся из той же перетасовки — иначе стена
  // прыгала бы при каждом повороте телефона.
  const shuffled = useMemo(() => shuffle(PHOTOS).slice(0, MAX_ON_WALL), []);
  const columns = useMemo(() => buildColumns(shuffled, columnCount), [shuffled, columnCount]);

  // Дрейф: колонки едут с разной скоростью по прогрессу прокрутки секции.
  // Считаем в rAF и только пока секция на экране — вне неё слушателя нет.
  useEffect(() => {
    const section = sectionRef.current;
    const wall = wallRef.current;
    if (!section || !wall || !PHOTOS.length) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    let running = false;

    const apply = () => {
      raf = 0;
      const rect = section.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // 0 — секция только показалась снизу, 1 — уже уехала вверх.
      const progress = Math.max(0, Math.min(1, (vh - rect.top) / (vh + rect.height)));
      wall.style.setProperty('--drift', String((progress - 0.5) * 2)); // -1…1
    };

    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply); };

    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !running) {
        running = true;
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
      } else if (!entry.isIntersecting && running) {
        running = false;
        window.removeEventListener('scroll', onScroll);
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }, { threshold: 0 });
    io.observe(section);

    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [columnCount]);

  // Фото нет вовсе (папка пуста / манифест не собран) — секции просто нет.
  if (!PHOTOS.length) return null;

  const maxTilt = columnCount <= 2 ? 2.5 : 6; // на телефоне «рассыпанность» убираем — на 390px это грязь

  return (
    <section id="wall" className="wall" ref={sectionRef}>
      <div className="wall__inner">
        <div ref={r0} className="reveal mb-10" style={{ textAlign: 'center' }}>
          <span className="sec-label">{tx.wallLabel}</span>
        </div>
        <h2 ref={r1} className="reveal wall__title">{tx.wallTitle}</h2>
      </div>

      <div ref={rWall} className="reveal">
        <div className="wall__grid" ref={wallRef}>
          {columns.map((col, ci) => (
            <div
              key={ci}
              className="wall__col"
              // Соседние колонки дрейфуют в разные стороны и с разной силой —
              // так стена «дышит», а не едет одним куском. Стартовый сдвиг
              // ломает ровную линию верхнего края: без него это сетка, а не
              // россыпь.
              style={{
                '--col-speed': (ci % 2 === 0 ? 1 : -1) * (0.6 + (ci % 3) * 0.35),
                '--col-offset': `${(ci % 2 === 0 ? -1 : 1) * (18 + (ci % 3) * 26)}px`,
              }}
            >
              {col.map((p) => (
                <figure
                  key={p.src}
                  className="wall__item"
                  style={{ '--tilt': `${tiltFor(p.src, maxTilt).toFixed(2)}deg`, aspectRatio: `${p.w} / ${p.h}` }}
                >
                  <img
                    src={p.src}
                    srcSet={p.srcSm ? `${p.srcSm} 480w, ${p.src} 900w` : undefined}
                    sizes="(max-width: 560px) 46vw, (max-width: 900px) 31vw, (max-width: 1200px) 24vw, 17vw"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={p.w}
                    height={p.h}
                    draggable="false"
                  />
                </figure>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
