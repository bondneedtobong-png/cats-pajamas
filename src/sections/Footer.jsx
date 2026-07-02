import { Link } from 'react-router-dom';

export default function Footer({ tx }) {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__brand">
          <img src="/uploads/logo-icon.svg" className="footer__glass-icon" alt="" />
          <span className="footer__brand-text">THE CAT'S PAJAMAS CLUB</span>
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
