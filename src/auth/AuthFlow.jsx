import { useState, useEffect, useRef } from 'react';
import AuthService from './AuthService.js';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

// ─── Phone step ───────────────────────────────────────────────
function PhoneStep({ onOtpSent }) {
  const [phone,   setPhone]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const devCode = await AuthService.requestOtp(phone);
      onOtpSent(phone, devCode);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="auth-field">
        <label className="auth-label">НОМЕР ТЕЛЕФОНА</label>
        <input
          className="auth-input"
          type="tel"
          placeholder="+7 (900) 000-00-00"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          autoFocus
        />
      </div>
      {error && <div className="auth-error">{error}</div>}
      <button className="auth-btn" type="submit" disabled={loading || !phone.trim()}>
        {loading ? 'Отправляем…' : 'Получить код'}
      </button>
    </form>
  );
}

// ─── OTP step ─────────────────────────────────────────────────
function OtpStep({ phone, devCode, onSuccess, onBack }) {
  const [code,    setCode]    = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await AuthService.verifyOtp(phone, code);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const maskedPhone = phone.replace(/\D/g, '').slice(-4);

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <p className="auth-hint">
        Код отправлен на номер, оканчивающийся на <strong>…{maskedPhone}</strong>
      </p>

      {/* Dev-mode mock code display */}
      {devCode && (
        <div className="auth-dev-code">
          <span className="auth-dev-code__lbl">DEV — ваш код:</span>
          <span className="auth-dev-code__val">{devCode}</span>
        </div>
      )}

      <div className="auth-field">
        <label className="auth-label">КОД ИЗ SMS</label>
        <input
          className="auth-input auth-input--code"
          type="text"
          inputMode="numeric"
          maxLength={4}
          placeholder="0000"
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          autoFocus
        />
      </div>
      {error && <div className="auth-error">{error}</div>}
      <button className="auth-btn" type="submit" disabled={loading || code.length < 4}>
        {loading ? 'Проверяем…' : 'Войти'}
      </button>
      <button type="button" className="auth-link" onClick={onBack}>
        ← Изменить номер
      </button>
    </form>
  );
}

// ─── Telegram step (реальный вход через бота) ──────────────────
// Виджет входа Telegram не умеет отдавать номер телефона — единственный
// способ его получить — через диалог с ботом (request_contact). Поэтому вход
// устроен так: сайт создаёт токен → открывает бота по deep-link → поллит
// статус, пока гость подтверждает подписку+телефон в самом Telegram.
function TelegramLoginStep({ onSuccess, onSwitchToPhone }) {
  // state: 'idle' | 'waiting' | 'timeout' | 'error'
  const [state,    setState]    = useState('idle');
  const [error,    setError]    = useState('');
  const [deepLink, setDeepLink] = useState('');
  const pollRef    = useRef(null);
  const timeoutRef = useRef(null);

  function stopWaiting() {
    if (pollRef.current)    clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current = null;
    timeoutRef.current = null;
  }
  useEffect(() => () => stopWaiting(), []);

  async function handleStart() {
    setError('');
    setState('waiting');
    try {
      const { token, deepLink: link } = await AuthService.startTelegramLogin();
      setDeepLink(link);
      window.open(link, '_blank', 'noopener,noreferrer');

      pollRef.current = setInterval(async () => {
        try {
          const r = await AuthService.checkTelegramLogin(token);
          if (r.status === 'completed') {
            stopWaiting();
            onSuccess();
          } else if (r.status === 'expired' || r.status === 'not_found') {
            stopWaiting();
            setState('timeout');
          }
        } catch { /* сетевой сбой при поллинге — не прерываем, попробуем ещё раз */ }
      }, POLL_INTERVAL_MS);

      timeoutRef.current = setTimeout(() => {
        stopWaiting();
        setState('timeout');
      }, POLL_TIMEOUT_MS);
    } catch (e) {
      setState('error');
      setError(e.message);
    }
  }

  function handleRetry() {
    stopWaiting();
    setState('idle');
  }

  return (
    <div className="auth-form">
      {state === 'idle' && (
        <p className="auth-hint">
          Вход и регистрация — через Telegram. Понадобится подписка на канал заведения
          и номер телефона (чтобы администратор мог связаться с вами по брони).
        </p>
      )}

      {state === 'idle' && (
        <button className="auth-btn auth-btn--tg" onClick={handleStart}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.247l-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.88 14.03l-2.948-.924c-.64-.203-.654-.64.136-.954l11.527-4.445c.535-.194 1.002.131.967.54z"/>
          </svg>
          Войти через Telegram
        </button>
      )}

      {state === 'waiting' && (
        <div className="auth-checking">
          <div className="auth-checking__spinner" />
          <p>Мы открыли бота в Telegram — подтвердите вход там (подписка + номер телефона).</p>
          {deepLink && (
            <a href={deepLink} target="_blank" rel="noopener noreferrer" className="auth-link">
              Не открылось? Открыть бота вручную
            </a>
          )}
        </div>
      )}

      {state === 'timeout' && (
        <>
          <div className="auth-error">Не дождались подтверждения в Telegram — попробуйте снова.</div>
          <button className="auth-btn" onClick={handleRetry}>Попробовать снова</button>
        </>
      )}

      {state === 'error' && (
        <>
          <div className="auth-error">{error}</div>
          <button className="auth-btn" onClick={handleRetry}>Попробовать снова</button>
        </>
      )}

      {state === 'idle' && (
        <button type="button" className="auth-link" onClick={onSwitchToPhone}>
          Войти по номеру телефона
        </button>
      )}
    </div>
  );
}

// ─── Combined flow (title + steps) — reused by the full /auth page
// and by AuthModal so the login logic exists exactly once. ────────
export default function AuthFlow({ onSuccess, subtitle = 'Для бронирования стола необходим аккаунт' }) {
  // step: 'telegram' | 'phone' | 'otp' — Telegram теперь основной способ входа.
  const [step,    setStep]    = useState('telegram');
  const [phone,   setPhone_]  = useState('');
  const [devCode, setDevCode] = useState('');

  function handleOtpSent(ph, code) {
    setPhone_(ph);
    setDevCode(code);
    setStep('otp');
  }

  return (
    <>
      <h1 className="auth-title">
        {step === 'otp' ? 'Подтверждение' : 'Войти или зарегистрироваться'}
      </h1>
      <p className="auth-sub">
        {step === 'otp' ? 'Введите код из SMS' : subtitle}
      </p>

      {step === 'telegram' && (
        <TelegramLoginStep
          onSuccess={onSuccess}
          onSwitchToPhone={() => setStep('phone')}
        />
      )}

      {step === 'phone' && (
        <>
          <PhoneStep onOtpSent={handleOtpSent} />
          <button type="button" className="auth-link" onClick={() => setStep('telegram')}>
            ← Войти через Telegram
          </button>
        </>
      )}

      {step === 'otp' && (
        <OtpStep
          phone={phone}
          devCode={devCode}
          onSuccess={onSuccess}
          onBack={() => setStep('phone')}
        />
      )}
    </>
  );
}
