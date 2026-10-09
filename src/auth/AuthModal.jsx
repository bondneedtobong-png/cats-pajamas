import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import AuthFlow from './AuthFlow.jsx';
import './auth.css';

// Same login flow as /auth, but as an overlay on top of whatever the guest
// was already looking at — closable with the × or Escape, instead of
// navigating away to a separate page and losing their place.
export default function AuthModal({ onClose, onSuccess, subtitle }) {
  const overlayRef = useRef(null);
  const dialogRef = useRef(null);
  const initiatorRef = useRef(document.activeElement);
  const closeRef = useRef(onClose);
  const titleId = useId();
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    const overlay = overlayRef.current;
    const initiator = initiatorRef.current;
    const bodyStyle = document.body.style;
    const previousOverflow = bodyStyle.getPropertyValue('overflow');
    const previousPriority = bodyStyle.getPropertyPriority('overflow');
    const inertBefore = new Map();
    const selector = 'button, a[href], input, select, textarea, [tabindex]';
    const available = element => element instanceof HTMLElement && element.isConnected
      && !element.matches(':disabled') && !element.closest('[inert], [hidden]')
      && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
    const focusables = () => Array.from(dialog.querySelectorAll(selector))
      .filter(element => available(element) && element.tabIndex >= 0);
    const focusInside = () => (focusables()[0] || dialog).focus({ preventScroll: true });

    // The existing visible AuthFlow heading remains the dialog's accessible name.
    dialog.querySelector('.auth-title').id = titleId;
    focusInside();
    const isolateBackground = () => {
      for (const element of document.body.children) {
        if (element === overlay || inertBefore.has(element)) continue;
        inertBefore.set(element, element.getAttribute('inert'));
        element.inert = true;
      }
    };
    isolateBackground();
    const observer = new MutationObserver(() => {
      isolateBackground();
      if (!dialog.contains(document.activeElement)) focusInside();
    });
    observer.observe(document.body, { childList: true });
    observer.observe(dialog, { childList: true, subtree: true });
    bodyStyle.setProperty('overflow', 'hidden');

    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        // Recompute for every keypress: the shared login flow changes its controls.
        const controls = focusables();
        const first = controls[0];
        const last = controls[controls.length - 1];
        const active = document.activeElement;
        if (!first || !controls.includes(active) || (event.shiftKey ? active === first : active === last)) {
          event.preventDefault();
          (event.shiftKey ? last || dialog : first || dialog).focus({ preventScroll: true });
        }
      }
    };
    const onFocus = event => { if (!dialog.contains(event.target)) focusInside(); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);

    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      if (previousOverflow) bodyStyle.setProperty('overflow', previousOverflow, previousPriority);
      else bodyStyle.removeProperty('overflow');
      for (const [element, previousInert] of inertBefore) {
        if (previousInert === null) element.removeAttribute('inert');
        else element.setAttribute('inert', previousInert);
      }
      // A mobile login trigger lives in a menu that closes as the dialog opens.
      // Return to its visible menu button rather than the off-screen trigger.
      const canReturn = element => available(element)
        && !element.closest('.nav__mobile:not(.nav__mobile--open)');
      const fallback = ['.nav__burger', '.nav__tg', '.nav__logo', 'main button', 'main a[href]']
        .flatMap(selector => Array.from(document.querySelectorAll(selector)))
        .find(canReturn);
      if (canReturn(initiator)) initiator.focus({ preventScroll: true });
      else fallback?.focus({ preventScroll: true });
    };
  }, [titleId]);

  function handleSuccess() {
    onSuccess?.();
    onClose();
  }

  return createPortal(
    <div className="auth-modal-overlay" ref={overlayRef} data-theme="A" onClick={onClose}>
      <div className="auth-card auth-card--modal" ref={dialogRef} role="dialog" aria-modal="true"
        aria-labelledby={titleId} tabIndex={-1} onClick={e => e.stopPropagation()}>
        <button className="auth-modal__close" onClick={onClose} aria-label="Закрыть">✕</button>

        <div className="auth-logo">
          <img src="/uploads/logo-icon.svg" alt="The Cat's Pajamas Club" style={{ height: 24, width: 'auto', display: 'block' }} />
          <span className="auth-logo__text">CAT'S PAJAMAS</span>
        </div>

        <div className="auth-divider" />

        <AuthFlow onSuccess={handleSuccess} subtitle={subtitle} />
      </div>
    </div>, document.body
  );
}
