import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { translations } from './data.js';
import Nav      from './sections/Nav.jsx';
import Hero     from './sections/Hero.jsx';
import About    from './sections/About.jsx';
import Menu     from './sections/Menu.jsx';
import Events   from './sections/Events.jsx';
import Shelf    from './sections/Shelf.jsx';
import Team     from './sections/Team.jsx';
import Booking  from './sections/Booking.jsx';
import Contacts from './sections/Contacts.jsx';
import Footer   from './sections/Footer.jsx';
import FloorPlanPage from './booking/FloorPlanPage.jsx';
import AuthPage      from './auth/AuthPage.jsx';
import ProfilePage   from './profile/ProfilePage.jsx';
import AdminPage        from './admin/AdminPage.jsx';
import BookingRulesPage from './pages/BookingRulesPage.jsx';
import PrivacyPage      from './pages/PrivacyPage.jsx';
import NotFoundPage     from './pages/NotFoundPage.jsx';
import CookieBanner     from './CookieBanner.jsx';
import ErrorBoundary    from './ErrorBoundary.jsx';

function MainSite() {
  const [lang, setLang] = useState('ru');

  const tx = translations[lang];
  const toggleLang = () => setLang((l) => (l === 'ru' ? 'en' : 'ru'));

  return (
    <div className="app" data-theme="A">
      <Nav     tx={tx} lang={lang} onLangToggle={toggleLang} />
      <Hero    tx={tx} />
      <About   tx={tx} />
      <Menu    tx={tx} />
      <Events  tx={tx} lang={lang} />
      <Shelf   tx={tx} lang={lang} />
      <Team    tx={tx} />
      <Booking    tx={tx} />
      <Contacts tx={tx} />
      <Footer  tx={tx} />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/"        element={<MainSite />} />
        <Route path="/booking" element={<FloorPlanPage />} />
        <Route path="/auth"    element={<AuthPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/admin"         element={<AdminPage />} />
        <Route path="/booking-rules" element={<BookingRulesPage />} />
        <Route path="/privacy"       element={<PrivacyPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <CookieBanner />
    </ErrorBoundary>
  );
}
