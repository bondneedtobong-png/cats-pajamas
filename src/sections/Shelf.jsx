import { useState, useEffect } from 'react';
import { useReveal } from '../useReveal.js';
import AuthService from '../auth/AuthService.js';
import ReviewsService from '../reviews/ReviewsService.js';

// Тема "Воспоминания" в форум-группе @catspajam (id группы -1004486982537,
// message_thread_id=2) — см. /GUIDE_TELEGRAM_REVIEWS.md.
const REVIEW_DISCUSSION_URL = 'https://t.me/catspajam/2';

const BOTTLE_TYPES = ['rum', 'tequila', 'gin'];
const BOTTLE_LABELS = { rum: 'Ром', tequila: 'Текила', gin: 'Джин' };

// Hand-drawn bottle line art (client's own sketches, one <path> per bottle
// straight from the source SVGs — coordinates untouched, only the viewBox
// is cropped to each path's bounding box). Colored per drink: golden rum,
// silver tequila, blue gin, per the client's spec.
const BOTTLE_ART = {
  rum: {
    // The source drawing is the bottle silhouette (2 mirrored halves, filled
    // below) plus ~9 short facet/shine accent lines scattered across the
    // body. Those accents are meant to stay thin outline strokes — filling
    // them along with the body (as one path) turned them into large jagged
    // triangles, so they're rendered as a separate, unfilled path.
    viewBox: '-200 191 14933 29438',
    strokeWidth: 7.62,
    fill: 'rgba(212,168,67,.4)',
    stroke: '#D4A843',
    d: 'M10825.49 391.98l928.91 1.31 435.33 280.83c-50.66,206 -157.97,781.42 -159,791.72 -13.02,121.83 239.06,1.69 232.7,147.58 -5.25,117.89 -60.5,997.18 -114.06,1025.45 -302.64,160.22 -6.55,130.91 -1.87,450.41l41.11 2812.96c0,48.41 135.12,115.17 145.14,136.71 79.41,170.05 -23.97,1535.51 23.97,2006.81 42.05,413.79 2174.89,857.74 1942.1,3588.85 -68.36,802.12 -136.53,4138.62 -147.95,4366.35 -20.04,399 -191.4,2553.01 -219.78,2994.62 -76.78,1192.97 -64.98,2203.63 -26.78,3409.06 16.77,529.44 23.23,1040.16 68.83,1532.52 79.03,853.81 377.93,1963.07 450.69,2799.37 19.66,226.14 48.97,1816.62 4.4,1958.68 -230.07,733.57 -2605.54,657.72 -3601.03,649.95l3100.24 -6173.7m-3097.34 -22780.7l-928.91 1.31 -435.33 280.83c50.66,206.01 157.97,781.43 159,791.73 13.02,121.82 -239.06,1.68 -232.69,147.57 5.24,117.9 60.49,997.18 114.05,1025.46 302.64,160.22 6.55,130.91 1.87,450.41l-41.11 2812.95c0,48.41 -135.12,115.18 -145.14,136.71 -79.41,170.05 23.97,1535.52 -23.97,2006.81 -42.04,413.79 -2174.89,857.74 -1942.1,3588.85 68.36,802.13 136.53,4138.62 147.95,4366.35 20.04,399.01 191.4,2553.01 219.78,2994.62 76.78,1192.98 64.98,2203.63 26.78,3409.06 -16.76,529.45 -23.23,1040.16 -68.83,1532.52 -79.03,853.81 -372.97,1963.54 -450.69,2799.38 -17.88,192.33 -48.88,1816.8 -4.4,1958.67 229.89,733.48 2605.35,658.94 3600.84,651.17l-3056.51 -7699',
    accentD: 'M9298.87 8044.54l159.56 81.47 2665.94 -23.6 233.35 -56.65m-225.58 2813.04l-1290.36 -2744.97 -1103.83 2776.9 -513.71 -2714.91m-1452.55 13470.34l4360.45 -10787.36 1831.61 7696.57m-4225.8 -7664.64l-2125.26 6606.41m2125.26 -6606.41l4722.09 16825.19m-209.66 -15115.69l-7023.02 16093.76m117.89 -17228.77l5377.2 17849.42m1241.3 -10759.27l-5029.61 10758.05m3198 -18454.62l945.39 -2196.14',
  },
  tequila: {
    viewBox: '-200 369 19777 29274',
    strokeWidth: 20,
    fill: 'rgba(203,209,218,.35)',
    stroke: '#CBD1DA',
    d: 'M10612.44 617.75c-1097.4,-49.17 -2281.73,397.45 -2749.52,971.05 -531.55,651.96 -642.76,1808.9 -628.23,2573.31 1.31,68.46 386.45,1056.11 317.36,1054.11 -305.05,-9.06 -863.02,280.78 -906.94,554.37 -102.84,641.03 1335.59,248.76 1335.59,1608.76l-189.77 3389.1c-274.7,2230.28 -3644.36,3044.48 -4324.47,4557.73 -595.03,1323.96 -1018.7,4083.51 -1124.02,5495.17 -22.13,296.48 162.38,548.49 112.86,856.52 -93.02,578.03 -424.84,1175.97 -404.5,1380.47 38.24,383.55 233.54,620.63 221.79,1040.56 -11.07,397.38 -489.16,1123.47 -364.33,1331.71 124.83,208.23 149.45,585.56 165.84,1043.8 14.46,406.1 -153.88,810.19 -152.63,994.91 1.24,184.72 189.77,316.61 292.54,576.57 72.89,184.31 31.6,483.28 169.02,741.17 349.46,655.69 7029.24,458.87 7623.59,458.17 253.39,-0.27 509.28,-0.83 766.13,-1.66m-225.04 -28625.82c1097.4,-49.17 2281.74,397.45 2749.52,971.05 531.55,651.96 642.76,1808.9 628.24,2573.31 -1.32,68.46 -386.46,1056.11 -317.37,1054.11 305.06,-9.06 863.02,280.78 906.94,554.37 102.84,641.03 -1335.58,248.76 -1335.58,1608.76l189.77 3389.1c274.69,2230.28 3644.36,3044.48 4324.46,4557.73 595.04,1323.96 1018.7,4083.51 1124.03,5495.17 22.13,296.48 -162.39,548.49 -112.87,856.52 93.02,578.03 424.84,1175.97 404.51,1380.47 -38.25,383.55 -233.55,620.63 -221.79,1040.56 11.06,397.38 489.15,1123.47 364.32,1331.71 -124.83,208.23 -149.45,585.56 -165.84,1043.8 -14.45,406.1 153.88,810.19 152.63,994.91 -1.24,184.72 -189.77,316.61 -292.54,576.57 -72.89,184.31 -31.6,483.28 -169.02,741.17 -349.46,655.69 -7029.24,458.87 -7623.58,458.17 -253.4,-0.27 -509.28,-0.83 -766.14,-1.66m-2411.13 -21784.28l5207.68 -0.62m-5357.41 2674.56l5507.69 9.54',
  },
  gin: {
    viewBox: '-200 1438 16690 27907',
    strokeWidth: 20,
    fill: 'rgba(91,155,216,.35)',
    stroke: '#5B9BD8',
    d: 'M5433.46 13320.17c0,-1698.57 1458.93,-2567.63 2723.58,-3296.1 392.69,-226.17 713.9,-270.81 750.67,-699.5l33.37 -388.91 -27.84 -2509.25 -13.9 -1795.59 -167.03 -125.26 13.9 -2756.01 167.03 -97.44 3791.48 -13.91 161.58 125.26 -0.37 2730.53 -166.66 136.83 -76.18 4253.27 -7.33 409.68c-5.77,324.02 254.06,397.34 474.57,555.56 742.21,532.59 1232.11,539.57 2049.44,1394.91 725.68,759.39 1064.57,1391.22 1070.13,2407.69l80.56 14741.11 -576.26 464.21 -192.08 208.1 -9316.13 80.03 -336.16 -224.1 -528.23 -368.16 91.86 -15232.95zm1065.57 2796.87c859.07,-257.42 810.21,-709.84 793.11,-1294.9l7016.13 28.96c-86.02,468.56 123.51,1251.04 823.63,1220.2l-30.49 10066.59c-780.23,177.1 -855.83,587.72 -869.41,1220.19l-6848.31 -45.77c-8.62,-531.05 -532.75,-1209.51 -823.64,-1159.17l-61.02 -10036.1z',
  },
};

function BottleSvg({ type, className }) {
  const b = BOTTLE_ART[type];
  return (
    <svg className={className} viewBox={b.viewBox} style={{ overflow: 'visible', display: 'block' }} aria-hidden="true">
      <path d={b.d} fill={b.fill} fillRule="evenodd" stroke={b.stroke} strokeWidth={b.strokeWidth} strokeLinejoin="round" />
      {b.accentD && (
        <path d={b.accentD} fill="none" stroke={b.stroke} strokeWidth={b.strokeWidth} strokeLinecap="round" opacity=".6" />
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

export default function Shelf({ tx, lang, onRequestAuth }) {
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
                      <BottleSvg type="tequila" className="shelf-bottle shelf__bottle-ghost" />
                      <BottleSvg type="gin" className="shelf-bottle shelf__bottle-ghost" />
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
            <button className="shelf__cta-btn" onClick={onRequestAuth}>{tx.shelfCtaLoggedOut}</button>
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
