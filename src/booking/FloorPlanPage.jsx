import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import BookingWidget from './BookingWidget.jsx';
import { translations } from '../data.js';
import { useTelegramWebApp } from '../useTelegramWebApp.js';
import { usePageMeta } from '../usePageMeta.js';
import './booking.css';

// /booking — тонкая standalone-обёртка того же виджета брони, что живёт на
// главной в книге. Остаётся ради Mini App бота (кнопка «🪑 Открыть») и старых
// ссылок. TG SDK грузится ТОЛЬКО здесь (useTelegramWebApp) — глобально он
// конфликтует с fixed-шапкой лендинга (уже чинили, см. HANDOFF_VPS_MIGRATION).
export default function FloorPlanPage() {
  usePageMeta({
    title: "Бронирование столика — The Cat's Pajamas Club, джаз-бар в Самаре",
    description: 'Забронируйте столик в джаз-баре «Пижама Кота» (The Cat\'s Pajamas Club) в Самаре: план зала, выбор стола и времени. Ул. Куйбышева, 98.',
    canonical: 'https://cats-pajamas.ru/booking',
  });
  const tx = translations.ru; // Mini App и прямые ссылки — русскоязычные
  const [authTick, setAuthTick] = useState(0);
  // Тихий вход по initData при открытии как Mini App; пинаем виджет
  // перечитать AuthService после логина.
  useTelegramWebApp(useCallback(() => setAuthTick(n => n + 1), []));

  return (
    // data-theme="A" — та же AMBER NIGHT, что на лендинге. Без неё /booking
    // жил на fallback-палитре виджета (фиолет + другое золото) и выглядел
    // чужой страницей: главная причина «отстал от оформления сайта».
    <div className="bk-root bk-root--v2" data-theme="A">
      <header className="bk-header bk-header--v2">
        <Link to="/" className="bk-header__logo u-glare">
          <img src="/uploads/logo-icon.svg" alt="The Cat's Pajamas Club" style={{ height: 24, width: 'auto', display: 'block' }} />
          <span className="bk-header__logo-text">CAT'S PAJAMAS</span>
        </Link>
        <div className="bk-header__divider" />
        <span className="bk-header__title">{tx.bookingTitle.toUpperCase()}</span>
        {/* Телефон в шапке: гостю без Telegram не нужно искать его в панели. */}
        <a className="bk-header__phone u-glare" href="tel:+79084180009">+7 (908) 418-00-09</a>
      </header>
      <div className="bk-body--v2">
        {/* Обложка страницы — тем же языком, что главы лендинга: подпись
            капителью, заголовок Baskerville, лид курсивом Involve. Без неё
            /booking выглядел служебным экраном, а не частью сайта бара. */}
        <div className="bk-cover">
          <span className="bk-cover__kicker">{tx.bkPageKicker}</span>
          <h1 className="bk-cover__title">{tx.bkPageTitle}</h1>
          <p className="bk-cover__lead">{tx.bkPageLead}</p>
          <span className="bk-cover__rule" aria-hidden="true" />
        </div>
        <BookingWidget tx={tx} active variant="standalone" authTick={authTick} />
      </div>
    </div>
  );
}
