// Google Analytics / Яндекс.Метрика — loaded ONLY after cookie consent, and
// only if a real ID is configured via env vars. No ID is hardcoded here —
// TODO: set VITE_GA_ID / VITE_YM_ID in Vercel → Project → Environment Variables
// once the client provides real tracking IDs. Without them this module is a
// deliberate no-op (nothing loads, nothing tracks).
const GA_ID = import.meta.env.VITE_GA_ID;
const YM_ID = import.meta.env.VITE_YM_ID;

const CONSENT_KEY = 'cpjc_cookie_consent'; // 'accepted' | 'declined'
let initialized = false;

export function getConsent() {
  try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
}

export function setConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* ignore */ }
  if (value === 'accepted') initAnalytics();
}

/** Hard gate: never loads any tracking script without prior consent. */
export function initAnalytics() {
  if (initialized) return;
  if (getConsent() !== 'accepted') return;
  initialized = true;

  if (GA_ID) {
    const s = document.createElement('script');
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    s.async = true;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
  }

  if (YM_ID) {
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      k = e.createElement(t); a = e.getElementsByTagName(t)[0];
      k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
    window.ym(YM_ID, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true });
  }
}

// Returning visitor who already consented — init immediately on load.
if (typeof window !== 'undefined' && getConsent() === 'accepted') {
  initAnalytics();
}
