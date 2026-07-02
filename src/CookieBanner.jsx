import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getConsent, setConsent } from './analytics.js';

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!getConsent()) setVisible(true);
  }, []);

  function accept() { setConsent('accepted'); setVisible(false); }
  function decline() { setConsent('declined'); setVisible(false); }

  if (!visible) return null;

  return (
    <div className="cookie-banner">
      <p className="cookie-banner__text">
        Мы используем файлы cookie для аналитики посещаемости сайта.{' '}
        <Link to="/privacy" className="cookie-banner__link">Подробнее</Link>
      </p>
      <div className="cookie-banner__actions">
        <button className="cookie-banner__decline" onClick={decline}>Отклонить</button>
        <button className="cookie-banner__accept" onClick={accept}>Принять</button>
      </div>
    </div>
  );
}
