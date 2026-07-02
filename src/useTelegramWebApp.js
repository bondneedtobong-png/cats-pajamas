import { useEffect } from 'react';
import AuthService from './auth/AuthService.js';

// Shared by any page that can be opened as a Telegram Mini App (bot → webApp
// button). Telegram re-signs initData on every open, so we log in silently
// every time rather than relying on localStorage surviving between sessions
// (WebView storage behaviour differs across Telegram clients).
//
// The SDK script is loaded HERE, per-page, not globally in index.html: outside
// Telegram it still tries to negotiate viewport/safe-area with a host that
// doesn't exist, which fights with position:fixed elements like the site nav.
// Only pages meant to run as a Mini App should call this hook.
export function useTelegramWebApp(onAuth) {
  useEffect(() => {
    function tryAuth() {
      const tg = window.Telegram?.WebApp;
      if (!tg?.initData) return; // открыто обычным браузером, не как Mini App
      tg.ready();
      tg.expand();
      AuthService.authViaTelegramWebApp(tg.initData)
        .then(onAuth)
        .catch(() => {}); // тихо — гость всё ещё может пользоваться страницей анонимно
    }

    if (window.Telegram?.WebApp) { tryAuth(); return; }
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-web-app.js';
    script.async = true;
    script.onload = tryAuth;
    document.head.appendChild(script);
    // Скрипт нарочно не убираем при размонтировании — безобиден, если
    // остаётся, а удаление могло бы прервать загрузку в процессе.
  }, [onAuth]);
}
