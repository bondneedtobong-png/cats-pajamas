import { useEffect, useRef } from 'react';

export function useReveal(delay = 0) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (delay) {
            setTimeout(() => el.classList.add('visible'), delay);
          } else {
            el.classList.add('visible');
          }
          obs.unobserve(el);
        }
      },
      { threshold: 0.07 }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [delay]);

  return ref;
}

// Редизайн 2026-07-07: замена старого `.book__page:not(--active) { ... paused }`
// селектора теперь, когда книги-перелистывания больше нет. Toggle-версия
// useReveal — не unobserve после первого срабатывания, а держит класс
// синхронным с тем, виден ли элемент хоть частично (threshold:0), чтобы
// бесконечные анимации (Ken Burns и т.п.) можно было ставить на паузу, когда
// секция прокручена далеко за пределы экрана.
export function useOffscreenPause() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        el.classList.toggle('is-offscreen', !entry.isIntersecting);
      },
      { threshold: 0 }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return ref;
}
