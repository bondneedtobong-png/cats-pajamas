// Три кандидата на «единый язык hover'ов» (HANDOFF_RESTYLE §C.2).
// Основа — react-bits (MIT, DavidHDev/react-bits), но реализация своя, потому
// что оригиналы тянут лишнее или бьют по производительности:
//
//  • GlareHover  — оригинал гонит блик через `transition: background-position`,
//    то есть перекрашивает элемент каждый кадр. Ровно этот приём давал рябь
//    шапки (баг 2026-08-22). Здесь тот же блик едет transform'ом — картинка
//    не отличается, слой не перерисовывается.
//  • Magnet      — оригинал вешает свой window.mousemove на КАЖДЫЙ элемент.
//    Для языка «на весь сайт» это десятки слушателей и десятки setState за
//    кадр. Здесь один общий слушатель на всех, координаты пишутся прямо в
//    style (без ререндера React).
//  • Tilt        — оригинал требует motion/react (framer-motion, ~40 КБ) ради
//    пружины. Здесь наклон на CSS-переходе, зависимостей ноль.
//
// Обёртки универсальные: работают и на карточке с фото, и на кнопке, и на
// ссылке — язык должен быть один на весь сайт, а не по эффекту на секцию.
import { useEffect, useRef } from 'react';

const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── 1. Glare: косой блик проезжает по элементу ─────────────────────────── */
export function Glare({ children, className = '', ...rest }) {
  return (
    <div className={`hv-glare ${className}`} {...rest}>
      {children}
      <span className="hv-glare__sheen" aria-hidden="true" />
    </div>
  );
}

/* ── 2. Magnet: элемент тянется к курсору ───────────────────────────────── */
// Один слушатель на всех подписчиков + запись в style внутри rAF.
const magnets = new Set();
let magnetRaf = 0;
let pointer = { x: 0, y: 0 };

function magnetTick() {
  magnetRaf = 0;
  for (const { el, padding, strength } of magnets) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = pointer.x - cx;
    const dy = pointer.y - cy;
    const near = Math.abs(dx) < r.width / 2 + padding && Math.abs(dy) < r.height / 2 + padding;
    el.style.transform = near ? `translate3d(${dx / strength}px, ${dy / strength}px, 0)` : 'translate3d(0, 0, 0)';
    el.style.transition = near ? 'transform .18s ease-out' : 'transform .5s cubic-bezier(.16,1,.3,1)';
  }
}

function onPointerMove(e) {
  pointer = { x: e.clientX, y: e.clientY };
  if (!magnetRaf) magnetRaf = requestAnimationFrame(magnetTick);
}

export function Magnet({ children, padding = 90, strength = 3.5, className = '', ...rest }) {
  const ref = useRef(null);

  useEffect(() => {
    if (REDUCED()) return;
    const entry = { el: ref.current, padding, strength };
    if (!magnets.size) window.addEventListener('pointermove', onPointerMove, { passive: true });
    magnets.add(entry);
    return () => {
      magnets.delete(entry);
      if (!magnets.size) {
        window.removeEventListener('pointermove', onPointerMove);
        cancelAnimationFrame(magnetRaf);
        magnetRaf = 0;
      }
    };
  }, [padding, strength]);

  return (
    <div className={`hv-magnet ${className}`} {...rest}>
      <div className="hv-magnet__inner" ref={ref}>{children}</div>
    </div>
  );
}

/* ── 3. Tilt: плоскость доворачивается к курсору ────────────────────────── */
export function Tilt({ children, amplitude = 10, scale = 1.04, className = '', ...rest }) {
  const ref = useRef(null);

  const onMove = (e) => {
    if (REDUCED()) return;
    const el = ref.current;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${-py * 2 * amplitude}deg) rotateY(${px * 2 * amplitude}deg) scale(${scale})`;
    // блик едет за курсором — без него наклон читается как перекос, а не объём
    el.style.setProperty('--tilt-x', `${(px + 0.5) * 100}%`);
    el.style.setProperty('--tilt-y', `${(py + 0.5) * 100}%`);
  };

  const reset = () => {
    ref.current.style.transform = 'perspective(900px) rotateX(0) rotateY(0) scale(1)';
  };

  return (
    <div className={`hv-tilt ${className}`} onMouseMove={onMove} onMouseLeave={reset} {...rest}>
      <div className="hv-tilt__inner" ref={ref}>
        {children}
        <span className="hv-tilt__sheen" aria-hidden="true" />
      </div>
    </div>
  );
}

export const HOVER_VARIANTS = {
  glare: { Wrap: Glare, title: 'Glare — блик проезжает по элементу' },
  magnet: { Wrap: Magnet, title: 'Magnet — элемент тянется к курсору' },
  tilt: { Wrap: Tilt, title: 'Tilt — плоскость доворачивается к курсору' },
};
