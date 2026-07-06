import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { translations, pageImages } from './data.js';
import Nav      from './sections/Nav.jsx';
import Hero     from './sections/Hero.jsx';
import About    from './sections/About.jsx';
import Menu     from './sections/Menu.jsx';
import Events   from './sections/Events.jsx';
// import Shelf from './sections/Shelf.jsx'; // полка в разработке (см. PAGES)
import Team     from './sections/Team.jsx';
import Booking  from './sections/Booking.jsx';
import Contacts from './sections/Contacts.jsx';
import Footer   from './sections/Footer.jsx';
import PageBackdrop from './sections/PageBackdrop.jsx';
import AuthModal from './auth/AuthModal.jsx';
import CookieBanner     from './CookieBanner.jsx';
import ErrorBoundary    from './ErrorBoundary.jsx';

// Не-лендинговые маршруты грузим лениво: они не нужны для первой отрисовки
// главной (LCP), а /admin особенно тяжёлый. MainSite ниже остаётся eager.
// Обёрнуто в <Suspense> в App().
const FloorPlanPage    = lazy(() => import('./booking/FloorPlanPage.jsx'));
const BarMenuPage      = lazy(() => import('./menu/BarMenuPage.jsx'));
const AuthPage         = lazy(() => import('./auth/AuthPage.jsx'));
const ProfilePage      = lazy(() => import('./profile/ProfilePage.jsx'));
const AppHubPage       = lazy(() => import('./app/AppHubPage.jsx'));
const AdminPage        = lazy(() => import('./admin/AdminPage.jsx'));
const BookingRulesPage = lazy(() => import('./pages/BookingRulesPage.jsx'));
const PrivacyPage      = lazy(() => import('./pages/PrivacyPage.jsx'));
const NotFoundPage     = lazy(() => import('./pages/NotFoundPage.jsx'));

// The landing is a "bar menu" of fixed full-screen pages that turn like
// paper instead of scrolling. Every page stays mounted the whole time (not
// conditionally rendered) so the API-backed carousels (Menu/Events/Shelf/
// Team) keep their fetched state and current slide across navigation —
// only the CSS transform in .book__page moves them in and out of view.
// «Полка воспоминаний» ('gallery' + <Shelf/>) временно скрыта — в разработке
// (решение владельца, 2026-07-05). Вернуть: добавить 'gallery' после 'events',
// раскомментировать рендер Shelf ниже и ссылки «Полка» в Nav.jsx.
const PAGES = ['hero', 'about', 'menu', 'events', 'team', 'booking', 'contacts'];

function BookControls({ index, onPrev, onNext }) {
  return (
    <div className="book-controls">
      <button
        className="book-controls__arrow book-controls__arrow--prev"
        onClick={onPrev}
        disabled={index === 0}
        aria-label="Предыдущая страница"
      >
        ‹
      </button>
      <span className="book-controls__count">
        {String(index + 1).padStart(2, '0')} / {String(PAGES.length).padStart(2, '0')}
      </span>
      <button
        className="book-controls__arrow book-controls__arrow--next"
        onClick={onNext}
        disabled={index === PAGES.length - 1}
        aria-label="Следующая страница"
      >
        ›
      </button>
    </div>
  );
}

function MainSite() {
  const [lang, setLang] = useState('ru');
  const [activeIndex, setActiveIndex] = useState(0);
  // Login opens as an overlay on top of whatever page the guest is on
  // (see AuthModal) instead of navigating away to /auth and losing their
  // place — triggered from Nav's "Войти через Telegram" and Shelf's
  // "leave a review" CTA.
  const [authOpen, setAuthOpen] = useState(false);

  const tx = translations[lang];
  const toggleLang = () => setLang((l) => (l === 'ru' ? 'en' : 'ru'));

  const jumpTo = useCallback((target) => {
    setActiveIndex(Math.max(0, Math.min(PAGES.length - 1, target)));
  }, []);
  const goToPage = useCallback((id) => {
    const i = PAGES.indexOf(id);
    if (i !== -1) jumpTo(i);
  }, [jumpTo]);
  const goNext = useCallback(() => jumpTo(activeIndex + 1), [jumpTo, activeIndex]);
  const goPrev = useCallback(() => jumpTo(activeIndex - 1), [jumpTo, activeIndex]);

  // The book is a fixed viewport with no document scroll — each page fits
  // the screen on its own (see per-section fluid sizing in index.css).
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Arrow keys turn pages, same as clicking the flip controls — skip while
  // the user is typing in a form field (team join modal, etc).
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev]);

  const activePage = PAGES[activeIndex];

  return (
    <div className="app" data-theme="A">
      <PageBackdrop image={pageImages[activePage]} />

      <Nav tx={tx} lang={lang} onLangToggle={toggleLang} activePage={activePage} onNavigate={goToPage} onRequestAuth={() => setAuthOpen(true)} />

      <div className="book">
        {PAGES.map((id, i) => {
          const diff = i - activeIndex;
          const state = diff === 0 ? 'active' : diff < 0 ? 'before' : 'after';
          const z = 10 - Math.min(Math.abs(diff), 9);
          return (
            <div key={id} className={`book__page book__page--${state}`} style={{ zIndex: z }}>
              {id === 'hero'     && <Hero tx={tx} onNext={goNext} onBooking={() => goToPage('booking')} />}
              {id === 'about'    && <About tx={tx} />}
              {id === 'menu'     && <Menu tx={tx} onBooking={() => goToPage('booking')} />}
              {id === 'events'   && <Events tx={tx} lang={lang} />}
              {/* {id === 'gallery' && <Shelf tx={tx} lang={lang} onRequestAuth={() => setAuthOpen(true)} />} — полка в разработке */}
              {id === 'team'     && <Team tx={tx} />}
              {/* active гасит поллинг статусов столов на закрытой странице */}
              {id === 'booking'  && <Booking tx={tx} active={activePage === 'booking'} />}
              {id === 'contacts' && (
                <div className="contacts-page">
                  <Contacts tx={tx} />
                  <Footer tx={tx} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <BookControls index={activeIndex} onPrev={goPrev} onNext={goNext} />

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  );
}

// Тёмный полноэкранный лоадер на время подгрузки ленивого чанка маршрута.
function RouteFallback() {
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0C0A18', color: '#D4A843', fontFamily: "'Baskerville', serif", fontSize: 14, letterSpacing: 1,
    }}>
      Загрузка…
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/"        element={<MainSite />} />
          <Route path="/booking" element={<FloorPlanPage />} />
          <Route path="/menu"    element={<BarMenuPage />} />
          <Route path="/auth"    element={<AuthPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/app"     element={<AppHubPage />} />
          <Route path="/admin"         element={<AdminPage />} />
          <Route path="/booking-rules" element={<BookingRulesPage />} />
          <Route path="/privacy"       element={<PrivacyPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
      <CookieBanner />
    </ErrorBoundary>
  );
}
