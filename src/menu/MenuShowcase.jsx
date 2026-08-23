import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import photos from '../data/cocktailPhotos.generated.json';

// Витрина коктейлей справа от книги-меню: фото медленно стекают вниз, как в
// «Стене памяти» (src/sections/Wall.jsx) — тот же приём и та же механика:
// лента продублирована и едет ровно на половину своей высоты, поэтому круг
// бесшовный, а «остановить» — это animation-play-state, а не пересчёт в JS.
//
// Список фото не хардкодится: владелец кладёт снимки в public/uploads/cocktails/,
// scripts/generate-gallery-manifest.mjs жмёт их в webp и собирает
// src/data/cocktailPhotos.generated.json на predev/prebuild. Папка пуста —
// витрина просто не рендерится, книга от этого не разъезжается (место под
// колонку держит грид).

const PHOTOS = Array.isArray(photos?.photos) ? photos.photos : [];
const SPEED = 26; // пикселей в секунду — медленнее «Стены памяти»: тут узкая колонка

export default function MenuShowcase() {
  const rootRef = useRef(null);
  const trackRef = useRef(null);
  const [paused, setPaused] = useState(false);

  // Порядок фиксируем на жизнь компонента, чтобы витрина не перетасовывалась
  // при каждом ресайзе.
  const list = useMemo(() => {
    const a = [...PHOTOS];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }, []);

  // Длительность круга — из реальной высоты ленты: снимки разной пропорции,
  // фиксированной высоты у колонки нет.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const measure = () => {
      const loop = track.scrollHeight / 2; // лента продублирована
      track.style.setProperty('--mbook-drift', `${Math.max(14, loop / SPEED).toFixed(1)}s`);
    };
    measure();
    const ro = new ResizeObserver(measure); // картинки догружаются — высота растёт
    ro.observe(track);
    return () => ro.disconnect();
  }, [list.length]);

  // Вне экрана лента честно стоит: бесконечная анимация не жжёт батарею,
  // пока секции не видно (правило проекта).
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !list.length) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => root.classList.toggle('is-offscreen', !entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(root);
    return () => io.disconnect();
  }, [list.length]);

  if (!list.length) return <div className="mbook__showcase mbook__showcase--empty" aria-hidden="true" />;

  return (
    <div
      className="mbook__showcase"
      ref={rootRef}
      onPointerEnter={(e) => { if (e.pointerType !== 'touch') setPaused(true); }}
      onPointerLeave={() => setPaused(false)}
      aria-hidden="true"
    >
      <div className={`mbook__drift${paused ? ' mbook__drift--paused' : ''}`} ref={trackRef}>
        {[...list, ...list].map((p, i) => (
          <figure className="mbook__shot" key={`${p.src}-${i}`} style={{ aspectRatio: `${p.w} / ${p.h}` }}>
            <img
              src={p.src}
              srcSet={p.srcSm ? `${p.srcSm} 480w, ${p.src} 900w` : undefined}
              sizes="(max-width: 1000px) 40vw, 18vw"
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
    </div>
  );
}
