import { useState, useEffect } from 'react';
import AuthService from '../auth/AuthService.js';
import { pageImages } from '../data.js';

// Telegram — единственный способ входа/регистрации на сайте (см. AuthPage).
// Уже вошедшему гостю показываем ссылку на профиль вместо повторного «войти».
function TelegramNavLink({ loggedIn, onClick, tx }) {
  if (loggedIn) {
    return (
      <a href="/profile" className="nav__profile nav__shimmer" onClick={onClick} aria-label={tx.navProfile}>
        <svg className="nav__tg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="8" r="3.4" />
          <path d="M4.5 20c1.4-3.8 4.4-5.8 7.5-5.8s6.1 2 7.5 5.8" strokeLinecap="round" />
        </svg>
        <span className="nav__tg-label">{tx.navProfile}</span>
      </a>
    );
  }
  return (
    <a href="/auth?next=/profile" className="nav__tg nav__shimmer" onClick={onClick} aria-label={tx.navLoginTg}>
      <svg className="nav__tg-icon" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z" />
      </svg>
      <span className="nav__tg-label">{tx.navLoginTg}</span>
    </a>
  );
}

// Page-flip nav — clicking a link no longer scrolls, it turns the book to
// that page directly (App.jsx owns activePage/onNavigate). Renders as a
// vertical sidebar on the left from 900px up, and the usual burger + full
// screen overlay below that.
export default function Nav({ tx, lang, onLangToggle, activePage, onNavigate }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggedIn] = useState(() => AuthService.isAuthenticated());

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const close = () => setMenuOpen(false);
  const nav = (id) => (e) => { e.preventDefault(); onNavigate(id); close(); };

  const linkCls = (id) => `nav__link nav__shimmer${activePage === id ? ' nav__link--active' : ''}`;
  const mobileLinkCls = (id) => `nav__mobile-link nav__shimmer${activePage === id ? ' nav__mobile-link--active' : ''}`;
  // Small placeholder photo per page — reused from the global backdrop set
  // until the client sources custom thumbnails per section.
  const linkStyle = (id) => ({ '--link-img': `url(${pageImages[id]})` });

  return (
    <>
      <nav className="nav">
        <a href="#" className="nav__logo" onClick={nav('hero')} aria-label="The Cat's Pajamas Club">
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
          <a href="#" style={linkStyle('about')}    className={linkCls('about')}    onClick={nav('about')}>{tx.navAbout}</a>
          <a href="#" style={linkStyle('menu')}     className={linkCls('menu')}     onClick={nav('menu')}>{tx.navMenu}</a>
          <a href="#" style={linkStyle('events')}   className={linkCls('events')}   onClick={nav('events')}>{tx.navEvents}</a>
          <a href="#" style={linkStyle('gallery')}  className={linkCls('gallery')}  onClick={nav('gallery')}>{tx.navGallery}</a>
          <a href="#" style={linkStyle('team')}     className={linkCls('team')}     onClick={nav('team')}>{tx.navTeam}</a>
          <a href="#" style={linkStyle('contacts')} className={linkCls('contacts')} onClick={nav('contacts')}>{tx.navContacts}</a>
        </div>

        <div className="nav__actions">
          <TelegramNavLink loggedIn={loggedIn} tx={tx} />
          <button className="nav__lang nav__shimmer" onClick={onLangToggle}>{tx.langBtn}</button>
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
        <a href="#" className={mobileLinkCls('about')}    onClick={nav('about')}>{tx.navAbout}</a>
        <a href="#" className={mobileLinkCls('menu')}     onClick={nav('menu')}>{tx.navMenu}</a>
        <a href="#" className={mobileLinkCls('events')}   onClick={nav('events')}>{tx.navEvents}</a>
        <a href="#" className={mobileLinkCls('gallery')}  onClick={nav('gallery')}>{tx.navGallery}</a>
        <a href="#" className={mobileLinkCls('team')}     onClick={nav('team')}>{tx.navTeam}</a>
        <a href="#" className={mobileLinkCls('contacts')} onClick={nav('contacts')}>{tx.navContacts}</a>
        <div className="nav__mobile-actions">
          <TelegramNavLink loggedIn={loggedIn} onClick={close} tx={tx} />
          <button className="nav__lang nav__shimmer" onClick={() => { onLangToggle(); close(); }}>{tx.langBtn}</button>
          <a href="/booking" className="nav__cta" onClick={close}>{tx.heroCta}</a>
        </div>
      </div>
    </>
  );
}
