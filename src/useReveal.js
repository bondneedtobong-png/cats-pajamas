import { useEffect, useRef } from 'react';

// ── Reveal-анимации ─────────────────────────────────────────────────────────
// Один общий IntersectionObserver на все .reveal + страховочный проход по
// геометрии. Наблюдатель — быстрый путь, проход — сетка безопасности: без неё
// блок остаётся `opacity: 0` навсегда. Оба сценария воспроизведены в Chrome на
// реальной машине (баг прода 2026-08-22):
//
//  1. threshold считает долю площади САМОГО элемента, а не экрана. У высокого
//     блока (.about__text — 1072px при экране 743px, на телефоне ещё выше)
//     видимая полоса в 40px даёт ratio 0.037 < 0.07 — элемент физически на
//     экране, а reveal не срабатывает. Отсюда threshold: 0 + rootMargin:
//     порог теперь «блок пересёк линию у нижнего края экрана», и высота
//     блока на него не влияет.
//  2. При быстрой прокрутке (свайп на телефоне, зажатый Page Down,
//     перетаскивание скроллбара) страницу двигает компоузер, а пересечения
//     считаются только в кадрах главного потока. Между двумя кадрами элемент
//     успевает проскочить экран насквозь — колбэк не приходит ВООБЩЕ.
//     Воспроизведено: после вихревой прокрутки .mb-18/.mb-50 в «Легенде»
//     остались невидимыми, хотя страница проехала прямо через них.
//
// Стоимость страховки: до пары десятков getBoundingClientRect, не чаще одного
// раза за кадр и только пока есть нераскрытые элементы — когда реестр пустеет,
// слушатели снимаются полностью.

// Порог красивого появления: «верх блока поднялся выше 94% высоты экрана».
// Считаем его сами по геометрии, а не rootMargin'ом наблюдателя: наблюдателю
// нужно узнавать и о блоке, который только выглянул краем (см. armPeek).
const ENTER_RATIO = 0.94;
const SETTLE_MS = 180; // столько тишины считаем «прокрутка закончилась»

const pending = new Map(); // el -> delay
const timers = new Map();  // el -> id таймера каскада
let io = null;
let sweepQueued = false;
let listening = false;
let settleTimer = 0;

function markVisible(el, skipDelay) {
  const delay = pending.get(el);
  if (delay === undefined) return;
  pending.delete(el);
  io?.unobserve(el);
  if (delay && !skipDelay) {
    timers.set(el, setTimeout(() => { timers.delete(el); el.classList.add('visible'); }, delay));
  } else {
    el.classList.add('visible');
  }
  if (!pending.size) stopListening();
}

// Проход двухрежимный, и это важно:
//   • в движении  — порог тот же, что у наблюдателя (блок заехал за линию 94%
//     высоты экрана), чтобы каскад появления выглядел как задуман;
//   • после остановки — «видно хоть пиксель». Иначе узкая полоса высокого
//     блока (тот самый случай с .about__text) честно остаётся прозрачной:
//     формально порога не достигла, а глазами текст на экране уже есть.
function sweep(settled) {
  sweepQueued = false;
  if (!pending.size) return;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  for (const el of [...pending.keys()]) {
    const r = el.getBoundingClientRect();
    // Блок целиком уехал выше экрана (его проскочили) — показываем сразу,
    // без каскадной задержки: анимировать то, что зритель уже миновал, незачем.
    if (r.bottom <= 0) markVisible(el, true);
    else if (r.top < (settled ? vh : vh * ENTER_RATIO)) markVisible(el, false);
  }
}

function queueSweep() {
  if (sweepQueued) return;
  sweepQueued = true;
  requestAnimationFrame(() => sweep(false));
}

// «Прокрутка остановилась» — свой таймер, а не событие scrollend: в Safari оно
// появилось только в 18-й версии, а страховка нужна везде. Взводится и от
// событий скролла, и от наблюдателя (блок выглянул краем и, возможно, на этом
// всё и замерло).
function armSettle() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => sweep(true), SETTLE_MS);
}

function onScroll() {
  queueSweep();
  armSettle();
}

// Не в движении: раскладку перекроили или вкладку вернули из фона (пока она
// скрыта, браузер не считает пересечения вообще — проверено: ноль колбэков и
// ноль кадров rAF). Здесь сразу мягкий режим.
function onSettledEvent() {
  requestAnimationFrame(() => sweep(true));
}

const SETTLED_EVENTS = ['resize', 'orientationchange', 'pageshow', 'load'];

function startListening() {
  if (listening) return;
  listening = true;
  window.addEventListener('scroll', onScroll, { passive: true });
  SETTLED_EVENTS.forEach(t => window.addEventListener(t, onSettledEvent, { passive: true }));
  document.addEventListener('visibilitychange', onSettledEvent);
}

function stopListening() {
  if (!listening) return;
  listening = false;
  clearTimeout(settleTimer);
  window.removeEventListener('scroll', onScroll);
  SETTLED_EVENTS.forEach(t => window.removeEventListener(t, onSettledEvent));
  document.removeEventListener('visibilitychange', onSettledEvent);
}

function observer() {
  if (!io) {
    io = new IntersectionObserver((entries) => {
      const vh = window.innerHeight || document.documentElement.clientHeight;
      // Именно forEach по всем записям: при быстрой прокрутке в одном вызове
      // приезжает пачка (вошёл + вышел), и старый вариант `([entry]) => …`
      // молча терял всё, кроме первой.
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        if (e.boundingClientRect.top < vh * ENTER_RATIO) markVisible(e.target, false);
        // Блок пока только выглянул краем снизу: показывать рано (иначе каскад
        // начнётся за кадром), но если прокрутка на этом и замрёт — полоса
        // текста останется прозрачной прямо на экране. Поэтому взводим таймер
        // остановки; продолжат крутить — наблюдатель сообщит снова.
        else armSettle();
      });
    }, { threshold: 0 });
  }
  return io;
}

export function useReveal(delay = 0) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || el.classList.contains('visible')) return;

    pending.set(el, delay);
    startListening();
    observer().observe(el);
    queueSweep(); // элемент мог смонтироваться уже на экране

    return () => {
      const t = timers.get(el);
      if (t) { clearTimeout(t); timers.delete(el); }
      pending.delete(el);
      io?.unobserve(el);
      if (!pending.size) stopListening();
    };
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
      (entries) => {
        const last = entries[entries.length - 1]; // берём самое свежее состояние пачки
        el.classList.toggle('is-offscreen', !last.isIntersecting);
      },
      { threshold: 0 }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return ref;
}
