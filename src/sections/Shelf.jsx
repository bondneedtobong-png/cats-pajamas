import { useState, useEffect } from 'react';
import { useReveal } from '../useReveal.js';
import AuthService from '../auth/AuthService.js';
import ReviewsService from '../reviews/ReviewsService.js';
import PageBackdrop from './PageBackdrop.jsx';

// Тема "Воспоминания" в форум-группе @catspajam (id группы -1004486982537,
// message_thread_id=2) — см. /GUIDE_TELEGRAM_REVIEWS.md.
const REVIEW_DISCUSSION_URL = 'https://t.me/catspajam/2';

const BOTTLE_TYPES = ['sparkling', 'rum', 'brandy', 'whiskey', 'absinthe'];
const BOTTLE_LABELS = { sparkling: 'Игристое', rum: 'Ром', brandy: 'Бренди', whiskey: 'Виски', absinthe: 'Абсент' };

// Body/neck outlines — one continuous path per bottle, viewBox 0 0 70 170,
// base sits at y=164. Caps drawn separately (rect or ellipse) so each shape
// stays simple and reliable rather than one giant hand-fitted bezier.
const BOTTLE_PATHS = {
  whiskey:   'M15 164L15 70L26 44L44 44L55 70L55 164Z',
  rum:       'M17 164Q12 126 17 88Q20 72 28 58L42 58Q50 72 53 88Q58 126 53 164Z',
  brandy:    'M16 164Q10 131 16 98Q18 80 28.5 70L41.5 70Q52 80 54 98Q60 131 54 164Z',
  absinthe:  'M21 164L21 58L30 18L40 18L49 58L49 164Z',
  sparkling: 'M20 164Q15 118 19 85Q22 72 29 63L29 14L41 14L41 63Q48 72 51 85Q55 118 50 164Z',
};
const BOTTLE_CAPS = {
  whiskey:   { shape: 'rect', x: 24, y: 36, w: 22, h: 9 },
  rum:       { shape: 'rect', x: 26, y: 50, w: 18, h: 8 },
  brandy:    { shape: 'rect', x: 26.5, y: 62, w: 17, h: 8 },
  absinthe:  { shape: 'rect', x: 28.5, y: 10, w: 13, h: 8 },
  sparkling: { shape: 'ellipse', cx: 35, cy: 8, rx: 10, ry: 6 },
};
const BOTTLE_LIQUID = {
  whiskey:   { x: 18, y: 110, w: 34, h: 50, color: 'rgba(212,168,67,.4)' },
  rum:       { x: 20, y: 110, w: 30, h: 50, color: 'rgba(168,105,40,.45)' },
  brandy:    { x: 19, y: 118, w: 32, h: 42, color: 'rgba(196,110,55,.45)' },
  absinthe:  { x: 24, y: 100, w: 22, h: 60, color: 'rgba(140,200,120,.35)' },
  sparkling: { x: 21, y: 118, w: 28, h: 42, color: 'rgba(230,205,150,.35)' },
};

function BottleSvg({ type, className }) {
  const cap = BOTTLE_CAPS[type];
  const liquid = BOTTLE_LIQUID[type];
  return (
    <svg className={className} viewBox="0 0 70 170" style={{ overflow: 'visible', display: 'block' }} aria-hidden="true">
      <rect x={liquid.x} y={liquid.y} width={liquid.w} height={liquid.h} rx="3" fill={liquid.color} />
      <path d={BOTTLE_PATHS[type]} fill="rgba(212,168,67,.07)" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
      {cap.shape === 'rect' ? (
        <rect x={cap.x} y={cap.y} width={cap.w} height={cap.h} rx="2" fill="rgba(212,168,67,.12)" stroke="currentColor" strokeWidth="2.2" />
      ) : (
        <ellipse cx={cap.cx} cy={cap.cy} rx={cap.rx} ry={cap.ry} fill="rgba(212,168,67,.12)" stroke="currentColor" strokeWidth="2.2" />
      )}
      {type === 'sparkling' && (
        <path d="M27 16 L23 23 M43 16 L47 23" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      )}
      {type === 'absinthe' && (
        <rect x="30" y="106" width="10" height="10" transform="rotate(45 35 111)" fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".6" />
      )}
    </svg>
  );
}

// Simple deterministic string hash — used so each review always gets the
// same shelf + tilt/offset, instead of re-randomizing on every render/reload.
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const MONTHS = {
  ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
function formatReviewDate(dateStr, lang) {
  const d = new Date(dateStr + 'T00:00:00');
  const month = (MONTHS[lang] || MONTHS.ru)[d.getMonth()];
  return `${month} ${d.getFullYear()}`;
}

export default function Shelf({ tx, lang }) {
  const [reviews,     setReviews]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [reading,     setReading]     = useState(null);  // review being read
  const [showLeave,   setShowLeave]   = useState(false); // "leave a memory" modal
  const r0 = useReveal(0);
  const r1 = useReveal(100);

  useEffect(() => {
    let alive = true;
    ReviewsService.getPublic()
      .then(list => { if (alive) setReviews(list); })
      .catch(() => { if (alive) setReviews([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const isLoggedIn = AuthService.isAuthenticated();

  // Distribute reviews across 3 shelves: type cycles in order (per bar's
  // request — no meaning attached yet), shelf + tilt are seeded-random so
  // bottles look hand-placed but don't jump around between renders.
  const shelves = [[], [], []];
  reviews.forEach((rv, i) => {
    const type = BOTTLE_TYPES[i % BOTTLE_TYPES.length];
    const h = hashStr(rv.id);
    const shelfIdx = h % 3;
    const tilt = ((h >> 3) % 7) - 3;      // -3..3 deg
    const lift = ((h >> 6) % 5);          // 0..4 px
    shelves[shelfIdx].push({ ...rv, type, tilt, lift });
  });

  function handleCtaClick() {
    if (!isLoggedIn) return; // link handles navigation to /auth
    setShowLeave(true);
  }

  return (
    <section id="shelf" className="shelf">
      <PageBackdrop image="/uploads/team/bar-hall.jpg" />
      <div className="shelf__dots" />
      <div className="shelf__inner">
        <div className="shelf__head">
          <div ref={r0} className="reveal mb-10">
            <span className="sec-label">{tx.galleryLabel}</span>
          </div>
          <h2 ref={r1} className="reveal shelf__title">{tx.galleryTitle}</h2>
          <p className="shelf__intro">{tx.galleryIntro}</p>
        </div>

        {loading && <p className="shelf__note">{tx.reviewsLoading}</p>}

        {!loading && (
          <div className="shelf__unit">
            {shelves.map((bottles, si) => (
              <div key={si} className="shelf__band">
                <div className="shelf__bottles">
                  {bottles.length === 0 && reviews.length === 0 && si === 1 && (
                    <>
                      <BottleSvg type="rum" className="shelf-bottle shelf__bottle-ghost" />
                      <BottleSvg type="whiskey" className="shelf-bottle shelf__bottle-ghost" />
                      <BottleSvg type="sparkling" className="shelf-bottle shelf__bottle-ghost" />
                    </>
                  )}
                  {bottles.map((rv) => (
                    <button
                      key={rv.id}
                      className="shelf__bottle-btn"
                      style={{ transform: `translateY(-${rv.lift}px) rotate(${rv.tilt}deg)` }}
                      onClick={() => setReading(rv)}
                      title={`${BOTTLE_LABELS[rv.type]} · ${rv.author}`}
                      aria-label={`Отзыв от ${rv.author}`}
                    >
                      <BottleSvg type={rv.type} className="shelf-bottle" />
                    </button>
                  ))}
                </div>
                <div className="shelf__plank"><div className="shelf__glow" /></div>
              </div>
            ))}
          </div>
        )}

        {!loading && reviews.length === 0 && (
          <p className="shelf__note" style={{ marginTop: -24, marginBottom: 40 }}>{tx.reviewsEmpty}</p>
        )}

        <div className="shelf__cta">
          {isLoggedIn ? (
            <button className="shelf__cta-btn" onClick={handleCtaClick}>{tx.shelfCtaLoggedIn}</button>
          ) : (
            <a className="shelf__cta-btn" href="/auth?next=/">{tx.shelfCtaLoggedOut}</a>
          )}
        </div>
      </div>

      {reading && (
        <div className="shelf-modal-overlay" onClick={() => setReading(null)}>
          <div className="shelf-modal" onClick={e => e.stopPropagation()}>
            <button className="shelf-modal__close" onClick={() => setReading(null)} aria-label={tx.shelfReadClose}>✕</button>
            <svg className="shelf-modal__quote-icon" viewBox="0 0 48 48" width="30" height="30" fill="currentColor">
              <path d="M12 32c0-6.627 5.373-12 12-12V12C13.163 12 6 19.163 6 28v8h6v-4zm18 0c0-6.627 5.373-12 12-12V12c-10.837 0-18 7.163-18 16v8h6v-4z" />
            </svg>
            <div className="shelf-modal__stars">
              {Array.from({ length: reading.rating }).map((_, i) => <span key={i} className="shelf-modal__star">★</span>)}
            </div>
            <p className="shelf-modal__text">{reading.text}</p>
            <div className="shelf-modal__divider" />
            <div className="shelf-modal__author">{reading.author}</div>
            <div className="shelf-modal__date">{formatReviewDate(reading.date, lang)}</div>
          </div>
        </div>
      )}

      {showLeave && (
        <div className="shelf-modal-overlay" onClick={() => setShowLeave(false)}>
          <div className="shelf-modal" onClick={e => e.stopPropagation()}>
            <button className="shelf-modal__close" onClick={() => setShowLeave(false)} aria-label={tx.shelfModalClose}>✕</button>
            <h3 className="shelf-modal__title">{tx.shelfModalTitle}</h3>
            <p className="shelf-modal__body">{tx.shelfModalText}</p>
            <a
              href={REVIEW_DISCUSSION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="shelf-modal__link"
              onClick={() => setShowLeave(false)}
            >
              {tx.shelfModalBtn}
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
