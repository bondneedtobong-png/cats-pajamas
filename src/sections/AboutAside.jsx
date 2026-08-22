import { useState, useEffect } from 'react';
import { useReveal } from '../useReveal.js';
import ReviewsService from '../reviews/ReviewsService.js';
import PressService from '../press/PressService.js';

// Правая колонка «Легенды»: на широком экране заполняет поля по бокам текста,
// на узком уезжает под него одним столбцом (см. .about__layout в index.css).
// Оба блока — только чтение из уже существующих публичных эндпоинтов;
// пустой ответ или недоступный API = блок просто не рендерится (паттерн
// `.catch(() => setX([]))`, как во всех секциях).

const MAX_REVIEWS = 4;
const MAX_MENTIONS = 3;

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return '';
  return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

function Card({ label, children, delay }) {
  const ref = useReveal(delay);
  return (
    <div ref={ref} className="reveal about-aside__card">
      <span className="about-aside__label">{label}</span>
      {children}
    </div>
  );
}

// ─── Отзывы гостей ─────────────────────────────────────────────────────────
// Приходят из Telegram-обсуждения канала, публично только active + rating>=4
// (фильтр на сервере, см. api/_lib/reviews.js) — здесь просто берём свежие.
function ReviewsWidget({ tx }) {
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    let alive = true;
    ReviewsService.getPublic()
      .then((list) => { if (alive) setReviews(list.slice(0, MAX_REVIEWS)); })
      .catch(() => setReviews([]));
    return () => { alive = false; };
  }, []);

  if (!reviews.length) return null;

  return (
    <Card label={tx.aboutReviewsLabel} delay={0}>
      <ul className="about-aside__list">
        {reviews.map((r) => (
          <li key={r.id} className="about-aside__item">
            <div className="about-aside__row">
              <span className="about-aside__name">{r.author}</span>
              <span className="about-aside__stars" aria-label={`${r.rating} из 5`}>{'★'.repeat(r.rating)}</span>
            </div>
            {r.text && <p className="about-aside__text">{r.text}</p>}
            <span className="about-aside__meta">{formatDate(r.date)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ─── Упоминания в изданиях ─────────────────────────────────────────────────
// Дословные выдержки из публикаций + ссылка на источник. Наполняется вручную
// через админку (вкладка «Издания») — придумывать цитаты от лица изданий нельзя.
function PressWidget({ tx }) {
  const [mentions, setMentions] = useState([]);

  useEffect(() => {
    let alive = true;
    PressService.getPublic()
      .then((list) => { if (alive) setMentions(list.slice(0, MAX_MENTIONS)); })
      .catch(() => setMentions([]));
    return () => { alive = false; };
  }, []);

  if (!mentions.length) return null;

  return (
    <Card label={tx.aboutPressLabel} delay={120}>
      <ul className="about-aside__list">
        {mentions.map((m) => (
          <li key={m.id} className="about-aside__item">
            <p className="about-aside__quote">«{m.excerpt}»</p>
            <a
              className="about-aside__source u-glare"
              href={m.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {m.sourceName}
              <span className="about-aside__meta"> · {formatDate(m.publishedAt)}</span>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function AboutAside({ tx }) {
  return (
    <aside className="about__aside">
      <ReviewsWidget tx={tx} />
      <PressWidget tx={tx} />
    </aside>
  );
}
