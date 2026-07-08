import { Link } from 'react-router-dom';

export default function Footer({ tx }) {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__brand">
          <img src="/uploads/logo-wordmark.svg" className="footer__wordmark" alt="Пижама Кота" />
        </div>
        <div className="footer__links">
          <Link to="/booking-rules" className="footer__link">{tx.footerBookingRules}</Link>
          <Link to="/privacy" className="footer__link">{tx.footerPrivacy}</Link>
        </div>
        <span className="footer__copy">{tx.footerCopy}</span>
      </div>
    </footer>
  );
}
