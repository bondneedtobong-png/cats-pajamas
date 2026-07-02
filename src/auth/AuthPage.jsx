import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthFlow from './AuthFlow.jsx';
import './auth.css';

// Full-page /auth — kept for entry points with nowhere sensible to render
// a modal behind them (e.g. visiting /profile or /admin directly while
// logged out). The landing page and the booking flow use <AuthModal>
// instead so the guest never loses their place — see AuthModal.jsx.
export default function AuthPage() {
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const nextUrl        = searchParams.get('next') || '/booking';

  function handleSuccess() {
    navigate(nextUrl, { replace: true });
  }

  return (
    <div className="auth-root">
      <div className="auth-card">
        {/* Logo */}
        <Link to="/" className="auth-logo">
          <img src="/uploads/logo-icon.svg" alt="The Cat's Pajamas Club" style={{ height: 24, width: 'auto', display: 'block' }} />
          <span className="auth-logo__text">CAT'S PAJAMAS</span>
        </Link>

        <div className="auth-divider" />

        <AuthFlow onSuccess={handleSuccess} />

        <div className="auth-back-link">
          <Link to={nextUrl} className="auth-link">← Назад к плану зала</Link>
        </div>
      </div>
    </div>
  );
}
