import { useState, useEffect } from 'react';
import AuthService from '../auth/AuthService.js';

const SECTION_IDS = ['about', 'menu', 'events', 'team', 'contacts'];

// Telegram — единственный способ входа/регистрации на сайте (см. AuthPage).
// Уже вошедшему гостю показываем ссылку на профиль вместо повторного «войти».
function TelegramNavLink({ loggedIn, onClick, tx }) {
  if (loggedIn) {
    return (
      <a href="/profile" className="nav__profile" onClick={onClick} aria-label={tx.navProfile}>
        <svg className="nav__tg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="8" r="3.4" />
          <path d="M4.5 20c1.4-3.8 4.4-5.8 7.5-5.8s6.1 2 7.5 5.8" strokeLinecap="round" />
        </svg>
        <span className="nav__tg-label">{tx.navProfile}</span>
      </a>
    );
  }
  return (
    <a href="/auth?next=/profile" className="nav__tg" onClick={onClick} aria-label={tx.navLoginTg}>
      <svg className="nav__tg-icon" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z" />
      </svg>
      <span className="nav__tg-label">{tx.navLoginTg}</span>
    </a>
  );
}

export default function Nav({ tx, lang, onLangToggle }) {
  const [solid, setSolid] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState('');
  const [loggedIn] = useState(() => AuthService.isAuthenticated());

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > window.innerHeight * 0.82);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Highlight the nav link for whichever section currently owns the top of
  // the viewport — turns the smooth-scroll into a lively "you are here" cue.
  useEffect(() => {
    const sections = SECTION_IDS
      .map(id => document.getElementById(id))
      .filter(Boolean);
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    sections.forEach(s => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const close = () => setMenuOpen(false);

  const linkCls = (id) => `nav__link${active === id ? ' nav__link--active' : ''}`;

  return (
    <>
      <nav className={`nav${solid ? ' nav--solid' : ''}`}>
        <a href="#hero" className="nav__logo" onClick={close} aria-label="The Cat's Pajamas Club">
          <svg className="nav__cat" viewBox="0 0 64 64" width="38" height="38" fill="none"
               stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            {/* ears (animate on hover) */}
            <path className="nav__cat-ear nav__cat-ear--l" d="M19 21 L15 7 L29 16" />
            <path className="nav__cat-ear nav__cat-ear--r" d="M45 21 L49 7 L35 16" />
            {/* head */}
            <path d="M16 22 Q12 30 12 37 Q12 51 32 53 Q52 51 52 37 Q52 30 48 22" />
            {/* eyes */}
            <circle cx="25" cy="34" r="1.7" fill="currentColor" stroke="none" />
            <circle cx="39" cy="34" r="1.7" fill="currentColor" stroke="none" />
            {/* nose + mouth */}
            <path d="M30 40 Q32 42 34 40" />
            {/* whiskers */}
            <path className="nav__cat-whiskers" d="M20 37 L8 35 M20 41 L8 43 M44 37 L56 35 M44 41 L56 43" strokeWidth="1.4" />
          </svg>
        </a>

        <div className="nav__links">
          <a href="#about"    className={linkCls('about')}>{tx.navAbout}</a>
          <a href="#menu"     className={linkCls('menu')}>{tx.navMenu}</a>
          <a href="#events"   className={linkCls('events')}>{tx.navEvents}</a>
          <a href="#team"     className={linkCls('team')}>{tx.navTeam}</a>
          <a href="#contacts" className={linkCls('contacts')}>{tx.navContacts}</a>
        </div>

        <div className="nav__actions">
          <button className="nav__lang" onClick={onLangToggle}>{tx.langBtn}</button>
          <TelegramNavLink loggedIn={loggedIn} tx={tx} />
          <a href="/booking" className="nav__cta">{tx.heroCta}</a>
        </div>

        <button
          className={`nav__burger${menuOpen ? ' nav__burger--open' : ''}`}
          onClick={() => setMenuOpen(v => !v)}
          aria-label="Меню"
        >
          <span /><span /><span />
        </button>
      </nav>

      <div className={`nav__mobile${menuOpen ? ' nav__mobile--open' : ''}`}>
        <a href="#about"    className={`nav__mobile-link${active === 'about'    ? ' nav__mobile-link--active' : ''}`} onClick={close}>{tx.navAbout}</a>
        <a href="#menu"     className={`nav__mobile-link${active === 'menu'     ? ' nav__mobile-link--active' : ''}`} onClick={close}>{tx.navMenu}</a>
        <a href="#events"   className={`nav__mobile-link${active === 'events'   ? ' nav__mobile-link--active' : ''}`} onClick={close}>{tx.navEvents}</a>
        <a href="#team"     className={`nav__mobile-link${active === 'team'     ? ' nav__mobile-link--active' : ''}`} onClick={close}>{tx.navTeam}</a>
        <a href="#contacts" className={`nav__mobile-link${active === 'contacts' ? ' nav__mobile-link--active' : ''}`} onClick={close}>{tx.navContacts}</a>
        <div className="nav__mobile-actions">
          <button className="nav__lang" onClick={() => { onLangToggle(); close(); }}>{tx.langBtn}</button>
          <TelegramNavLink loggedIn={loggedIn} onClick={close} tx={tx} />
          <a href="/booking" className="nav__cta" onClick={close}>{tx.heroCta}</a>
        </div>
      </div>
    </>
  );
}
