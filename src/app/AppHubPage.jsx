import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthService from '../auth/AuthService.js';
import { useTelegramWebApp } from '../useTelegramWebApp.js';
import './apphub.css';

// Mini App home screen — opened from the bot's «🪑 Открыть» кнопка. One tap,
// one screen, straight to an action, no personal-account chrome in the way
// (that's what /profile is for). Not a route MainSite links to from the
// regular site nav — Telegram Mini Apps are the only intended entry point,
// though it works fine in a normal browser too (just skips the auto-login).
const TILES = [
  { to: '/booking',               icon: '🪑', label: 'План зала',   hint: 'Выбрать стол и время' },
  { to: '/profile?tab=reservations', icon: '📋', label: 'Мои брони',  hint: 'Что уже забронировано' },
  { to: '/profile?tab=loyalty',   icon: '🎖', label: 'Мой уровень', hint: 'Растёт с каждой бронью' },
  { to: '/',                      icon: '📅', label: 'События',     hint: 'Афиша заведения' },
];

export default function AppHubPage() {
  const [user, setUser] = useState(() => AuthService.getCurrentUser());
  useTelegramWebApp(setUser);

  return (
    <div className="apphub-root">
      <div className="apphub-card">
        <div className="apphub-logo">
          <img src="/uploads/logo-icon.svg" alt="" className="apphub-logo__icon" />
          <span className="apphub-logo__text">CAT'S PAJAMAS</span>
        </div>

        <p className="apphub-greeting">
          {user?.name ? `С возвращением, ${user.name}! 🎷` : 'Добро пожаловать! 🎷'}
        </p>

        <div className="apphub-grid">
          {TILES.map((t) => (
            <Link key={t.to} to={t.to} className="apphub-tile">
              <span className="apphub-tile__icon">{t.icon}</span>
              <span className="apphub-tile__label">{t.label}</span>
              <span className="apphub-tile__hint">{t.hint}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
