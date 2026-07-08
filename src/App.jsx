import { useState, lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { translations } from './data.js';
import Nav      from './sections/Nav.jsx';
import Hero     from './sections/Hero.jsx';
import About    from './sections/About.jsx';
import Team     from './sections/Team.jsx';
import Menu     from './sections/Menu.jsx';
import Events   from './sections/Events.jsx';
// import Shelf from './sections/Shelf.jsx'; // полка в разработке, решение владельца 2026-07-05
import Contacts from './sections/Contacts.jsx';
import Footer   from './sections/Footer.jsx';
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

// Редизайн 2026-07-07 (ветка redesign-scroll-v1): лендинг — обычная
// непрерывно скроллящаяся страница с fixed-меню сверху (см. Nav.jsx), по
// макету владельца. Раньше это была «книга» с 3D-перелистыванием
// (rotateY-страницы, .book/.book__page/.book-controls) — архитектура
// убрана целиком, см. HANDOFF-историю в корне репо. Booking-виджет больше
// не встроен на лендинг (в макете все CTA — просто ссылки на /booking,
// который остаётся полностью рабочим отдельным маршрутом) — Booking.jsx и
// PageBackdrop.jsx оставлены в репо неиспользуемыми, не удалены.
function MainSite() {
  const [lang, setLang] = useState('ru');
  // Login opens as an overlay (see AuthModal) instead of navigating away to
  // /auth and losing scroll position — triggered from Nav's "Войти через
  // Telegram".
  const [authOpen, setAuthOpen] = useState(false);

  const tx = translations[lang];
  const toggleLang = () => setLang((l) => (l === 'ru' ? 'en' : 'ru'));

  return (
    <div className="app" data-theme="A">
      <Nav tx={tx} lang={lang} onLangToggle={toggleLang} onRequestAuth={() => setAuthOpen(true)} />

      <main>
        <Hero tx={tx} />
        <About tx={tx} />
        <Team tx={tx} />
        <Menu tx={tx} />
        <Events tx={tx} lang={lang} />
        {/* <Shelf tx={tx} lang={lang} onRequestAuth={() => setAuthOpen(true)} /> — полка в разработке */}
        <Contacts tx={tx} />
        <Footer tx={tx} />
      </main>

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
