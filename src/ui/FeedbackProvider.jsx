import { createContext, useCallback, useContext, useRef, useState } from 'react';
import './feedback.css';

const FeedbackContext = createContext(null);

let toastSeq = 0;

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null); // { title, message, confirmLabel, cancelLabel, danger, resolve }
  const timers = useRef({});

  const dismissToast = useCallback((id) => {
    setToasts(list => list.filter(t => t.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const pushToast = useCallback((message, type) => {
    const id = ++toastSeq;
    setToasts(list => [...list, { id, message, type }]);
    timers.current[id] = setTimeout(() => dismissToast(id), 4000);
  }, [dismissToast]);

  const toast = useRef({
    success: (message) => pushToast(message, 'success'),
    error:   (message) => pushToast(message, 'error'),
  }).current;

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      setDialog({
        title: opts.title || 'Подтвердите действие',
        message: opts.message || '',
        confirmLabel: opts.confirmLabel || 'Подтвердить',
        cancelLabel: opts.cancelLabel || 'Отмена',
        danger: !!opts.danger,
        resolve,
      });
    });
  }, []);

  function closeDialog(result) {
    dialog?.resolve(result);
    setDialog(null);
  }

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}

      <div className="fb-toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={`fb-toast fb-toast--${t.type}`} onClick={() => dismissToast(t.id)}>
            <span className="fb-toast__icon">{t.type === 'success' ? '✓' : '✕'}</span>
            <span className="fb-toast__msg">{t.message}</span>
          </div>
        ))}
      </div>

      {dialog && (
        <div className="fb-confirm-overlay" onClick={() => closeDialog(false)}>
          <div className="fb-confirm" onClick={e => e.stopPropagation()}>
            <div className="fb-confirm__title">{dialog.title}</div>
            {dialog.message && <p className="fb-confirm__msg">{dialog.message}</p>}
            <div className="fb-confirm__actions">
              <button className="fb-btn fb-btn--ghost" onClick={() => closeDialog(false)}>{dialog.cancelLabel}</button>
              <button
                className={`fb-btn ${dialog.danger ? 'fb-btn--danger' : 'fb-btn--primary'}`}
                onClick={() => closeDialog(true)}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback() must be used within <FeedbackProvider>');
  return ctx;
}
