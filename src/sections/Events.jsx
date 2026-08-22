import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useReveal } from '../useReveal.js';
import EventsService from '../events/EventsService.js';

// Event content itself is RU-only (same decision as cocktails) — but the day
// label is a real calendar date, so we can derive it in either UI language
// for free, no extra admin work.
const WEEKDAYS = {
  ru: ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'],
  en: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
};
const MONTHS = {
  ru: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

function formatEventDay(dateStr, lang) {
  const d = new Date(dateStr + 'T00:00:00');
  const wd = WEEKDAYS[lang]?.[d.getDay()] ?? WEEKDAYS.ru[d.getDay()];
  const month = MONTHS[lang]?.[d.getMonth()] ?? MONTHS.ru[d.getMonth()];
  return `${wd} · ${d.getDate()} ${month}`;
}

// Миниатюра фото: <n>.webp → <n>.thumb.webp (соглашение eventPhotos.js).
// Внешние ссылки (не .webp, вставленные по URL) отдаём как есть.
function thumbSrc(url) {
  return typeof url === 'string' && url.endsWith('.webp') ? url.replace(/\.webp$/, '.thumb.webp') : url;
}

// Нормализуем массив фото события (imageUrls; фолбэк на старое imageUrl).
function photosOf(ev) {
  if (Array.isArray(ev.imageUrls) && ev.imageUrls.length) return ev.imageUrls.filter(Boolean);
  return ev.imageUrl ? [ev.imageUrl] : [];
}

function todayIso() { return new Date().toISOString().split('T')[0]; }

export default function Events({ tx, lang }) {
  const [events,   setEvents]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState('upcoming');
  const [openEv,   setOpenEv]   = useState(null); // раскрытое событие (модалка)
  const [lightbox, setLightbox] = useState(null); // { images, index }
  const r0 = useReveal(0);
  const r1 = useReveal(100);
  const rList = useReveal(0);

  useEffect(() => {
    let alive = true;
    // Один запрос на всё активное: переключение вкладок мгновенное, без
    // повторного похода в сеть (событий у бара десятки, не тысячи).
    EventsService.getPublicAll()
      .then(list => { if (alive) setEvents(list); })
      .catch(() => { if (alive) setEvents([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const { upcoming, past } = useMemo(() => {
    const today = todayIso();
    const up = events.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const pa = events.filter(e => e.date < today).sort((a, b) => b.date.localeCompare(a.date));
    return { upcoming: up, past: pa };
  }, [events]);

  // Первым экраном не показываем пустоту, если в соседней вкладке есть что
  // показать: программа у бара сезонная, между сериями концертов «Грядущих»
  // может не быть неделями.
  useEffect(() => {
    if (!loading && upcoming.length === 0 && past.length > 0) setTab('past');
  }, [loading, upcoming.length, past.length]);

  const list = tab === 'past' ? past : upcoming;
  const openLightbox = useCallback((images, index) => setLightbox({ images, index }), []);

  return (
    <section id="events" className="events">
      <div className="events__dots" />
      <div className="events__inner">
        <div className="events__tabs" role="tablist" aria-label={tx.eventsTitle}>
          {[['upcoming', tx.eventsTabUpcoming], ['past', tx.eventsTabPast]].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`events__tab u-glare${tab === key ? ' events__tab--active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div ref={r0} className="reveal mb-10">
          <span className="sec-label">{tx.eventsLabel}</span>
        </div>
        <h2 ref={r1} className="reveal events__title">{tx.eventsTitle}</h2>

        {loading && <p className="events__note">{tx.eventsLoading}</p>}
        {!loading && list.length === 0 && (
          <p className="events__note">{tab === 'past' ? tx.eventsEmptyPast : tx.eventsEmpty}</p>
        )}

        {!loading && list.length > 0 && (
          <div ref={rList} className="reveal">
            <EventsAccordion key={tab} events={list} lang={lang} tx={tx} onOpen={setOpenEv} />
          </div>
        )}
      </div>

      {openEv && (
        <EventDetails
          ev={openEv}
          lang={lang}
          tx={tx}
          onLightbox={openLightbox}
          onClose={() => setOpenEv(null)}
        />
      )}

      {lightbox && (
        <EventLightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndex={(i) => setLightbox(lb => ({ ...lb, index: i }))}
          onClose={() => setLightbox(null)}
          tx={tx}
        />
      )}
    </section>
  );
}

// ─── Витрина-«гармошка» ──────────────────────────────────────────────────────
// Идея и раскладка — Accordion Gallery с reactbits.dev, но реализация своя:
// оригинал тянет gsap (~35 КБ gzip) ради того, что здесь делает одна
// transition на flex-grow. Ширина панелей — единственное, что анимируется
// на главном потоке; на телефоне (≤900px) гармошка вообще выключается и
// превращается в обычный вертикальный список — на тач-экране «раскрытие по
// наведению» смысла не имеет, а слабому железу не нужны лишние кадры.
function EventsAccordion({ events, lang, tx, onOpen }) {
  const [active, setActive] = useState(0);
  const items = events.slice(0, 6); // больше шести панелей в ряд нечитаемо
  const grow = Math.max(2.6, items.length * 0.9); // насколько раскрывается активная

  return (
    <div className="evac">
      {items.map((ev, i) => {
        const photos = photosOf(ev);
        const cover = photos[0];
        const isActive = i === active;
        return (
          <article
            key={ev.id}
            className={`evac__panel${isActive ? ' evac__panel--active' : ''}${cover ? '' : ' evac__panel--nophoto'}`}
            style={{ flexGrow: isActive ? grow : 1 }}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
          >
            {cover && (
              <img className="evac__img" src={cover} alt="" loading="lazy" draggable="false" />
            )}
            <span className="evac__scrim" aria-hidden="true" />
            <span className="evac__date">{formatEventDay(ev.date, lang)}{ev.time ? ` · ${ev.time}` : ''}</span>
            {photos.length > 1 && <span className="evac__count" aria-hidden="true">🖼 {photos.length}</span>}
            <span className="evac__label">
              <span className="evac__bar" aria-hidden="true" />
              <span className="evac__name">{ev.title}</span>
            </span>
            {/* Кликабельна вся панель, а не только раскрытая: на тач-экране
                наведения нет, и «сначала раскрой, потом жми» там не работает. */}
            <button
              type="button"
              className="evac__hit"
              onClick={() => onOpen(ev)}
              onFocus={() => setActive(i)}
            >
              <span className="sr-only">{ev.title} — {tx.eventsOpenCard}</span>
            </button>
          </article>
        );
      })}
    </div>
  );
}

// ─── Раскрытое событие ───────────────────────────────────────────────────────
// Формат намеренно другой, чем у сетки снаружи (§B): крупное основное фото +
// стрип миниатюр, клик по миниатюре — лайтбокс-карусель.
function EventDetails({ ev, lang, tx, onLightbox, onClose }) {
  const photos = photosOf(ev);
  const [main, setMain] = useState(0);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div className="evdt" role="dialog" aria-modal="true" aria-label={ev.title} onClick={onClose}>
      <div className="evdt__card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="evdt__close" onClick={onClose} aria-label={tx.close}>✕</button>

        {photos.length > 0 && (
          <div className="evdt__gallery">
            <button
              type="button"
              className="evdt__main"
              onClick={() => onLightbox(photos, main)}
              aria-label={`${tx.eventsPhoto} ${main + 1}`}
            >
              <img src={photos[main]} alt="" loading="lazy" />
            </button>
            {photos.length > 1 && (
              <div className="evdt__strip">
                {photos.map((src, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`evdt__thumb${i === main ? ' evdt__thumb--active' : ''}`}
                    onClick={() => { setMain(i); onLightbox(photos, i); }}
                    onMouseEnter={() => setMain(i)}
                    aria-label={`${tx.eventsPhoto} ${i + 1}`}
                  >
                    <img src={thumbSrc(src)} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="evdt__body">
          <span className="evdt__date">{formatEventDay(ev.date, lang)}{ev.time ? ` · ${ev.time}` : ''}</span>
          <h3 className="evdt__title">{ev.title}</h3>
          {ev.description && <p className="evdt__text">{ev.description}</p>}
          {ev.channelPostUrl && (
            <a
              className="evdt__post u-glare"
              href={ev.channelPostUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {tx.eventsOpenPost} ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// Лёгкий лайтбокс-карусель: fixed-оверлей, стрелки/свайп/ESC, только
// transform/opacity, lazy-загрузка. Без внешних зависимостей.
function EventLightbox({ images, index, onIndex, onClose, tx }) {
  const touchX = useRef(null);
  const go = useCallback((delta) => {
    onIndex((index + delta + images.length) % images.length);
  }, [index, images.length, onIndex]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // фиксируем фон под оверлеем
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [go, onClose]);

  const many = images.length > 1;
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1);
    touchX.current = null;
  };

  return (
    <div className="evlb" role="dialog" aria-modal="true" onClick={onClose}>
      <button type="button" className="evlb__close" onClick={onClose} aria-label={tx.close || 'Закрыть'}>✕</button>
      {many && (
        <button type="button" className="evlb__nav evlb__nav--prev" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="←">‹</button>
      )}
      <div
        className="evlb__stage"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <img key={index} className="evlb__img" src={images[index]} alt="" />
      </div>
      {many && (
        <button type="button" className="evlb__nav evlb__nav--next" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="→">›</button>
      )}
      {many && <div className="evlb__counter">{index + 1} / {images.length}</div>}
    </div>
  );
}
