import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import BookingWidget from './BookingWidget.jsx';
import { translations } from '../data.js';
import { useTelegramWebApp } from '../useTelegramWebApp.js';
import './booking.css';

// /booking — тонкая standalone-обёртка того же виджета брони, что живёт на
// главной в книге. Остаётся ради Mini App бота (кнопка «🪑 Открыть») и старых
// ссылок. TG SDK грузится ТОЛЬКО здесь (useTelegramWebApp) — глобально он
// конфликтует с fixed-шапкой лендинга (уже чинили, см. HANDOFF_VPS_MIGRATION).
export default function FloorPlanPage() {
  const tx = translations.ru; // Mini App и прямые ссылки — русскоязычные
  const [authTick, setAuthTick] = useState(0);
  // Тихий вход по initData при открытии как Mini App; пинаем виджет
  // перечитать AuthService после логина.
  useTelegramWebApp(useCallback(() => setAuthTick(n => n + 1), []));

  return (
    <div className="bk-root bk-root--v2">
      <header className="bk-header bk-header--v2">
        <Link to="/" className="bk-header__logo">
          <img src="/uploads/logo-icon.svg" alt="The Cat's Pajamas Club" style={{ height: 24, width: 'auto', display: 'block' }} />
          <span className="bk-header__logo-text">CAT'S PAJAMAS</span>
        </Link>
        <div className="bk-header__divider" />
        <span className="bk-header__title">{tx.bookingTitle.toUpperCase()}</span>
      </header>
      <div className="bk-body--v2">
        <BookingWidget tx={tx} active variant="standalone" authTick={authTick} />
      </div>
    </div>
  );
}
