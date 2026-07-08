import { useState, useEffect } from 'react';
import AuthService from '../auth/AuthService.js';

// Telegram — единственный способ входа/регистрации на сайте (см. AuthModal).
// Уже вошедшему гостю показываем ссылку на профиль вместо повторного «войти».
// Не залогинен — открывает вход поверх текущей страницы, а не уводит на
// отдельный /auth (по прямому запросу пользователя).
function TelegramNavLink({ loggedIn, onClick, onRequestAuth, tx }) {
  if (loggedIn) {
    return (
      <a href="/profile" className="nav__profile nav__shimmer" onClick={onClick} aria-label={tx.navProfile}>
        <span className="nav__tg-label">{tx.navProfile}</span>
      </a>
    );
  }
  return (
    <button
      type="button"
      className="nav__tg nav__shimmer"
      onClick={() => { onClick?.(); onRequestAuth(); }}
      aria-label={tx.navLoginTg}
    >
      <span className="nav__tg-label">{tx.navLoginTg}</span>
    </button>
  );
}

// Редизайн 2026-07-07 (ветка redesign-scroll-v1): fixed-шапка сверху вместо
// левого сайдбара. Ссылки — обычные href="#id" (работают через
// scroll-behavior:smooth + scroll-margin-top на секциях в index.css), никакой
// index-навигации через App.jsx больше нет — активного «текущая страница»
// состояния тоже нет (в макете владельца ссылки не подсвечиваются).
export default function Nav({ tx, lang, onLangToggle, onRequestAuth }) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Not cached in state — read fresh on every render so it picks up a login
  // that just happened in AuthModal (which re-renders this via App.jsx's
  // authOpen state closing) without needing a page reload.
  const loggedIn = AuthService.isAuthenticated();
  // Ссылка в админку видна только админам; сервер всё равно проверяет роль
  // на каждом запросе — скрытие здесь только чтобы не смущать гостей.
  const isAdmin = AuthService.isAdmin();

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const close = () => setMenuOpen(false);

  return (
    <>
      <nav className="nav">
        <a href="#hero" className="nav__logo" aria-label="The Cat's Pajamas Club">
          <img src="/uploads/logo-wordmark.svg" alt="Пижама Кота" className="nav__logo-img" />
        </a>

        <div className="nav__links">
          <a href="#about"    className="nav__link nav__shimmer">{tx.navAbout}</a>
          <a href="#team"     className="nav__link nav__shimmer">{tx.navTeam}</a>
          <a href="#menu"     className="nav__link nav__shimmer">{tx.navMenu}</a>
          <a href="#events"   className="nav__link nav__shimmer">{tx.navEvents}</a>
          {/* «Полка» скрыта — в разработке (решение владельца 2026-07-05) */}
          <a href="#contacts" className="nav__link nav__shimmer">{tx.navContacts}</a>
        </div>

        {isAdmin && (
          <a href="/admin" className="nav__admin nav__shimmer" aria-label={tx.navAdmin}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
              <path d="M2 14h4M10 8h4M18 16h4" />
            </svg>
            {tx.navAdmin}
          </a>
        )}

        <div className="nav__actions">
          <TelegramNavLink loggedIn={loggedIn} onRequestAuth={onRequestAuth} tx={tx} />
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
        <a href="#about"    className="nav__mobile-link nav__shimmer" onClick={close}>{tx.navAbout}</a>
        <a href="#team"     className="nav__mobile-link nav__shimmer" onClick={close}>{tx.navTeam}</a>
        <a href="#menu"     className="nav__mobile-link nav__shimmer" onClick={close}>{tx.navMenu}</a>
        <a href="#events"   className="nav__mobile-link nav__shimmer" onClick={close}>{tx.navEvents}</a>
        {/* «Полка» скрыта — в разработке (решение владельца 2026-07-05) */}
        <a href="#contacts" className="nav__mobile-link nav__shimmer" onClick={close}>{tx.navContacts}</a>
        {isAdmin && (
          <a href="/admin" className="nav__mobile-link nav__mobile-link--admin nav__shimmer" onClick={close}>
            {tx.navAdmin}
          </a>
        )}
        <div className="nav__mobile-actions">
          <TelegramNavLink loggedIn={loggedIn} onClick={close} onRequestAuth={onRequestAuth} tx={tx} />
          <button className="nav__lang nav__shimmer" onClick={() => { onLangToggle(); close(); }}>{tx.langBtn}</button>
          <a href="/booking" className="nav__cta" onClick={close}>{tx.heroCta}</a>
        </div>
      </div>
    </>
  );
}
