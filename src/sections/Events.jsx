import { useState, useEffect, useCallback, useRef } from 'react';
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

export default function Events({ tx, lang }) {
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null); // { images, index }
  const r0 = useReveal(0);
  const r1 = useReveal(100);
  const rList = useReveal(0); // контейнер-группа для стаггера карточек (§C.3)

  useEffect(() => {
    let alive = true;
    EventsService.getPublic()
      .then(list => { if (alive) setEvents(list); })
      .catch(() => { if (alive) setEvents([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const openLightbox = useCallback((images, index) => setLightbox({ images, index }), []);

  return (
    <section id="events" className="events">
      <div className="events__dots" />
      <div className="events__inner">
        <div ref={r0} className="reveal mb-10">
          <span className="sec-label">{tx.eventsLabel}</span>
        </div>
        <h2 ref={r1} className="reveal events__title">{tx.eventsTitle}</h2>

        {loading && <p className="events__note">{tx.eventsLoading}</p>}
        {!loading && events.length === 0 && <p className="events__note">{tx.eventsEmpty}</p>}

        {!loading && events.length > 0 && (
          <div ref={rList} className="reveal-group events__list">
            {events.map((ev, i) => (
              <EventRow key={ev.id} ev={ev} index={i} lang={lang} tx={tx} onOpen={openLightbox} />
            ))}
          </div>
        )}
      </div>

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

function EventRow({ ev, index, lang, tx, onOpen }) {
  const photos = photosOf(ev);
  const hasImg = photos.length > 0;
  const gallery = photos.length > 1;
  const cover = photos[0];

  const cardProps = hasImg
    ? {
        style: { backgroundImage: `url(${cover})`, '--i': index },
        role: 'button',
        tabIndex: 0,
        onClick: () => onOpen(photos, 0),
        onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(photos, 0); } },
      }
    : { style: { '--i': index } };

  return (
    <div
      className={`reveal-item events__item${hasImg ? ' events__item--photo' : ''}${gallery ? ' events__item--gallery' : ''}`}
      {...cardProps}
    >
      {hasImg && <div className="events__item-overlay" />}
      {hasImg && <div className="events__corner events__corner--tl" aria-hidden="true" />}
      {hasImg && <div className="events__corner events__corner--br" aria-hidden="true" />}
      <div className="events__date">
        <div className="events__day">{formatEventDay(ev.date, lang)}</div>
        <div className="events__time">{ev.time}</div>
      </div>
      <div className="events__vline" />
      <div className="events__body">
        <h3 className="events__title-item">{ev.title}</h3>
        <p className="events__desc">{ev.description}</p>
        {gallery && (
          <div className="events__thumbs" onClick={(e) => e.stopPropagation()}>
            {photos.slice(0, 6).map((src, i) => (
              <button
                key={i}
                type="button"
                className="events__thumb"
                onClick={() => onOpen(photos, i)}
                aria-label={`${tx.eventsPhoto || 'Фото'} ${i + 1}`}
              >
                <img src={thumbSrc(src)} alt="" loading="lazy" />
                {i === 5 && photos.length > 6 && <span className="events__thumb-more">+{photos.length - 6}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {hasImg
        ? <span className="events__count" aria-hidden="true">{gallery ? `🖼 ${photos.length}` : '🔍'}</span>
        : (
          <svg className="events__arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        )}
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
