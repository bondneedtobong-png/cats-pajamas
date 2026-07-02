import { useState, useEffect } from 'react';
import { useReveal } from '../useReveal.js';
import EventsService from '../events/EventsService.js';
import PageBackdrop from './PageBackdrop.jsx';

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

export default function Events({ tx, lang }) {
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(true);
  const r0 = useReveal(0);
  const r1 = useReveal(100);

  useEffect(() => {
    let alive = true;
    EventsService.getPublic()
      .then(list => { if (alive) setEvents(list); })
      .catch(() => { if (alive) setEvents([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <section id="events" className="events">
      <PageBackdrop image="/uploads/team/live-music.jpg" />
      <div className="events__dots" />
      <div className="events__inner">
        <div ref={r0} className="reveal mb-10">
          <span className="sec-label">{tx.eventsLabel}</span>
        </div>
        <h2 ref={r1} className="reveal events__title">{tx.eventsTitle}</h2>

        {loading && <p className="events__note">{tx.eventsLoading}</p>}
        {!loading && events.length === 0 && <p className="events__note">{tx.eventsEmpty}</p>}

        {!loading && events.length > 0 && (
          <div className="events__list">
            {events.map((ev) => (
              <EventRow key={ev.id} ev={ev} lang={lang} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function EventRow({ ev, lang }) {
  const r = useReveal(0);
  const hasImg = !!ev.imageUrl;
  return (
    <div
      ref={r}
      className={`reveal events__item${hasImg ? ' events__item--photo' : ''}`}
      style={hasImg ? { backgroundImage: `url(${ev.imageUrl})` } : undefined}
    >
      {hasImg && <div className="events__item-overlay" />}
      <div className="events__date">
        <div className="events__day">{formatEventDay(ev.date, lang)}</div>
        <div className="events__time">{ev.time}</div>
      </div>
      <div className="events__vline" />
      <div className="events__body">
        <h3 className="events__title-item">{ev.title}</h3>
        <p className="events__desc">{ev.description}</p>
      </div>
      <svg className="events__arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M5 12h14M12 5l7 7-7 7" />
      </svg>
    </div>
  );
}
