import { useEffect } from 'react';
import AuthFlow from './AuthFlow.jsx';
import './auth.css';

// Same login flow as /auth, but as an overlay on top of whatever the guest
// was already looking at — closable with the × or Escape, instead of
// navigating away to a separate page and losing their place.
export default function AuthModal({ onClose, onSuccess, subtitle }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  function handleSuccess() {
    onSuccess?.();
    onClose();
  }

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div className="auth-card auth-card--modal" onClick={e => e.stopPropagation()}>
        <button className="auth-modal__close" onClick={onClose} aria-label="Закрыть">✕</button>

        <div className="auth-logo">
          <img src="/uploads/logo-icon.svg" alt="The Cat's Pajamas Club" style={{ height: 24, width: 'auto', display: 'block' }} />
          <span className="auth-logo__text">CAT'S PAJAMAS</span>
        </div>

        <div className="auth-divider" />

        <AuthFlow onSuccess={handleSuccess} subtitle={subtitle} />
      </div>
    </div>
  );
}
