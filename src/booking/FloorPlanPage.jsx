import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import BookingService from './BookingService.js';
import AuthService from '../auth/AuthService.js';
import AuthModal from '../auth/AuthModal.jsx';
import FloorPlanSvg from './FloorPlanSvg.jsx';
import DatePicker from './DatePicker.jsx';
import { BOOKING_RULES } from './bookingRules.js';
import { useFeedback } from '../ui/FeedbackProvider.jsx';
import { useTelegramWebApp } from '../useTelegramWebApp.js';
import './booking.css';

const TIME_SLOTS = ['17:00','17:30','18:00','18:30','19:00','19:30','20:00','20:30','21:00','21:30','22:00','22:30','23:00'];
const LIVE_REFRESH_MS = 18000; // keep the floor plan in sync with other viewers without a full reload
const TYPE_LABELS = { round: 'Круглый', square: 'Квадратный', booth: 'Диван', bar: 'Барная стойка' };
const SC = { vacant: '#22c55e', reserved: '#D4A843', occupied: '#9B5DE5' };

function todayIso() {
  return new Date().toISOString().split('T')[0];
}
function shiftDay(dateStr, delta) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + delta);
  return d.toISOString().split('T')[0];
}

// Loose check — just enough to catch obvious typos before the guest submits;
// the field stays optional, so this never blocks the booking itself.
function isValidPhone(value) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11;
}

// ─────────────────────────── Sidebar ───────────────────────────
// Guest-facing — no occupancy stats/dashboard numbers here, those are for
// staff. Just "what's happening at the tables right now", so a guest can
// see the room isn't fully booked without having to click around.
function Sidebar({ tables, selectedTime, selectedTableId, onSelectTable }) {
  const seated   = tables.filter(t => t.status === 'occupied'  && t.reservation);
  const upcoming = tables.filter(t => t.status === 'reserved'  && t.reservation);
  const noReservations = seated.length === 0 && upcoming.length === 0;

  function ResItem({ tbl, accent }) {
    const r = tbl.reservation;
    const isSel = tbl.id === selectedTableId;
    return (
      <div
        className={`bk-res-item${isSel ? ' bk-res-item--sel' : ''}`}
        style={{ borderLeftColor: isSel ? accent : 'transparent' }}
        onClick={() => onSelectTable(tbl.id)}
      >
        <div className="bk-res-item__row">
          <div className="bk-res-item__info">
            <div className="bk-res-item__name">{r.timeFrom} – {r.timeTo}</div>
            <div className="bk-res-item__meta">{r.guestsCount} из {tbl.activeSeatsCount} мест</div>
            <div className="bk-res-item__seats">
              {Array.from({ length: tbl.activeSeatsCount }).map((_, i) => (
                <span
                  key={i}
                  className="bk-seat-dot"
                  style={{ background: i < r.guestsCount ? accent : 'rgba(242,237,228,0.14)' }}
                />
              ))}
            </div>
          </div>
          <div className="bk-res-item__badge" style={{ color: accent, borderColor: accent + '44', background: accent + '18' }}>{tbl.id}</div>
        </div>
      </div>
    );
  }

  return (
    <aside className="bk-sidebar">
      {/* Reservation list */}
      <div className="bk-res-list">
        {seated.length > 0 && (
          <>
            <div className="bk-res-group" style={{ color: '#9B5DE5' }}>
              <span>ЗАНЯТО</span>
              <div className="bk-res-group__line" />
              <span className="bk-res-group__count">{seated.length}</span>
            </div>
            {seated.map(t => <ResItem key={t.id} tbl={t} accent="#9B5DE5" />)}
          </>
        )}
        {upcoming.length > 0 && (
          <>
            <div className="bk-res-group" style={{ color: '#D4A843', marginTop: 4 }}>
              <span>СКОРО</span>
              <div className="bk-res-group__line" />
              <span className="bk-res-group__count">{upcoming.length}</span>
            </div>
            {upcoming.map(t => <ResItem key={t.id} tbl={t} accent="#D4A843" />)}
          </>
        )}
        {noReservations && (
          <div className="bk-res-empty">
            <div className="bk-res-empty__icon">○</div>
            <div className="bk-res-empty__text">Нет броней на {selectedTime}</div>
          </div>
        )}
      </div>
    </aside>
  );
}

// ─── Auth gate shown inside the panel when user isn't logged in ───
// ── Status legend — a compact hint beside the floor plan, not a boxed
// dashboard panel (moved out of the sidebar, which used to pair it with
// the staff-only occupancy stats). ──
// Легенда — ОБЯЗАТЕЛЬНО цвет + текст (половина людей не считывает
// только-цветовые метки). «Бронь к времени» видна на самом столе.
function Legend() {
  return (
    <div className="bk-legend-hint">
      {[['var(--st-vacant)', 'Свободен'], ['var(--st-reserved)', 'Бронь'], ['var(--st-occupied)', 'Занят']].map(([c, l]) => (
        <span key={l} className="bk-legend-hint__item">
          <span className="bk-legend-hint__dot" style={{ background: c }} />
          {l}
        </span>
      ))}
    </div>
  );
}

// Opens the login as an overlay on top of the floor plan instead of
// navigating to /auth — the guest never loses their selected table.
function AuthGate({ tableId, onRequestAuth }) {
  return (
    <div className="bk-auth-gate">
      <div className="bk-auth-gate__icon">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <p className="bk-auth-gate__text">
        Чтобы забронировать <strong>{tableId}</strong>, войдите или создайте аккаунт.
        <br />
        <span style={{ opacity: 0.45, fontSize: 11 }}>План зала открыт для всех — только бронь требует входа.</span>
      </p>
      <button type="button" className="bk-auth-gate__btn" onClick={onRequestAuth}>
        Войти / Зарегистрироваться
      </button>
    </div>
  );
}

// ──────────────────────────── Panel ────────────────────────────
function InfoPanel({ table, date, time, onClose, onBooked, currentUser, onRequestAuth }) {
  const { toast } = useFeedback();
  const [step,        setStep]       = useState('booking'); // 'booking' | 'payment' | 'success'
  const [name,        setName]       = useState(currentUser?.name || '');
  const [phone,       setPhone]      = useState(currentUser?.phone ? '+' + currentUser.phone : '');
  const [guests,      setGuests]     = useState('2');
  const [duration,    setDuration]   = useState('120');
  const [note,        setNote]       = useState('');
  const [reservation, setReservation] = useState(null);
  const [paying,      setPaying]     = useState(false);
  const [agreed,      setAgreed]     = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    setName(currentUser?.name || '');
    setPhone(currentUser?.phone ? '+' + currentUser.phone : '');
    setGuests(String(Math.min(2, table?.activeSeatsCount || 2)));
    setDuration('120'); setNote('');
    setStep('booking'); setReservation(null); setPaying(false); setAgreed(false);
  }, [table?.id]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!table) return null;

  const { status, reservation: r } = table;
  const statusLabel = { vacant: '● СВОБОДЕН', reserved: '● СКОРО', occupied: '● ЗАНЯТ' }[status];
  const sc = SC[status];
  const seats = table.activeSeatsCount;

  const [booking, setBooking] = useState(false);

  async function handleBook() {
    if (!name.trim()) { toast.error('Введите имя гостя'); return; }
    const timeTo = BookingService.minToTime(BookingService.timeToMin(time) + parseInt(duration || 120));
    setBooking(true);
    try {
      const res = await BookingService.createReservation({
        tableId: table.id, date, timeFrom: time, timeTo,
        guestsCount: parseInt(guests || 2),
        guestName: name, guestPhone: phone, note,
        source: 'web',
        guestId: currentUser?.id || null,
      });
      setReservation(res);
      if (res.depositPrice > 0) {
        setStep('payment');
      } else {
        setStep('success');
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { onBooked(); }, 3500);
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBooking(false);
    }
  }

  async function handlePay() {
    setPaying(true);
    try {
      await BookingService.payDeposit(reservation.id);
      setStep('success');
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { onBooked(); }, 3500);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setPaying(false);
    }
  }

  async function handleCancelPayment() {
    try { await BookingService.cancelReservation(reservation.id, 'Гость отменил на шаге оплаты'); } catch { /* ignore */ }
    setReservation(null);
    setStep('booking');
    onBooked();
  }

  const open = !!table;

  return (
    <div className={`bk-panel${open ? ' bk-panel--open' : ''}`}>
      <div className="bk-panel__inner">

        {/* Header */}
        <div className="bk-panel__head">
          <div>
            <div className="bk-panel__title-row">
              <span className="bk-panel__table-id">{table.id}</span>
              <span className="bk-panel__zone">{table.zone}</span>
            </div>
            <div className="bk-panel__sub">{TYPE_LABELS[table.type] || table.type} · {seats} мест</div>
          </div>
          <button className="bk-panel__close" onClick={onClose}>✕</button>
        </div>

        {/* Status badge */}
        <div className="bk-panel__badge-row">
          <span className="bk-panel__badge" style={{ color: sc, borderColor: sc + '44', background: sc + '18' }}>
            {statusLabel}
          </span>
        </div>

        {/* Reservation info (occupied / reserved) — public view, no guest details */}
        {step === 'booking' && r && status !== 'vacant' && (
          <div className="bk-panel__body">
            <div className="bk-panel__field">
              <div className="bk-panel__field-lbl">ВРЕМЯ</div>
              <div className="bk-panel__field-val bk-panel__field-val--lg">{r.timeFrom} – {r.timeTo}</div>
            </div>
            <div className="bk-panel__field">
              <div className="bk-panel__field-lbl">ГОСТЕЙ</div>
              <div className="bk-panel__field-val">{r.guestsCount}</div>
            </div>
          </div>
        )}

        {/* Auth gate — anon user sees lock, not form */}
        {step === 'booking' && status === 'vacant' && !currentUser && (
          <AuthGate tableId={table.id} onRequestAuth={onRequestAuth} />
        )}

        {/* Booking form (vacant + authenticated) */}
        {step === 'booking' && status === 'vacant' && currentUser && (
          <div className="bk-panel__form">
            <div className="bk-form-field">
              <label className="bk-form-label">ИМЯ ГОСТЯ *</label>
              <input className="bk-form-input" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Иван Иванов" />
            </div>
            <div className="bk-form-field">
              <label className="bk-form-label">ТЕЛЕФОН</label>
              <input
                className={`bk-form-input${phone && !isValidPhone(phone) ? ' bk-form-input--warn' : ''}`}
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+7 (900) 000-00-00"
              />
              {phone && !isValidPhone(phone) && (
                <span className="bk-form-hint">Проверьте номер — бармен не сможет дозвониться</span>
              )}
            </div>
            <div className="bk-form-grid">
              <div className="bk-form-field">
                <label className="bk-form-label">ГОСТЕЙ</label>
                <select className="bk-form-select" value={guests} onChange={e => setGuests(e.target.value)}>
                  {Array.from({ length: Math.max(1, seats) }, (_, i) => String(i + 1)).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="bk-form-field">
                <label className="bk-form-label">ДЛИТЕЛЬНОСТЬ</label>
                <select className="bk-form-select" value={duration} onChange={e => setDuration(e.target.value)}>
                  <option value="90">1.5 ч</option>
                  <option value="120">2 ч</option>
                  <option value="150">2.5 ч</option>
                  <option value="180">3 ч</option>
                </select>
              </div>
            </div>
            <div className="bk-form-field">
              <label className="bk-form-label">ПОЖЕЛАНИЯ</label>
              <textarea className="bk-form-textarea" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="День рождения, аллергии..." />
            </div>
            {table.depositPrice > 0 && (
              <div className="bk-deposit-notice">
                <div className="bk-deposit-notice__row">
                  <span className="bk-deposit-notice__lbl">ДЕПОЗИТ</span>
                  <span className="bk-deposit-notice__val">{table.depositPrice.toLocaleString('ru-RU')} ₽</span>
                </div>
                <span className="bk-deposit-notice__sub">Оплачивается онлайн сразу после подтверждения брони</span>
              </div>
            )}
            <button className="bk-form-submit" onClick={handleBook} disabled={booking}>
              {booking ? 'Бронируем…' : `Забронировать ${table.id}`}
            </button>
          </div>
        )}

        {/* Payment step */}
        {step === 'payment' && reservation && (
          <div className="bk-panel__form">
            <div className="bk-payment">
              <div className="bk-payment__icon">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#D4A843" strokeWidth="1.5">
                  <rect x="1" y="5" width="22" height="14" rx="2" />
                  <path d="M1 10h22" />
                  <path d="M5 15h3" opacity="0.5" />
                </svg>
              </div>
              <div className="bk-payment__title">Оплата депозита</div>
              <div className="bk-payment__sub">
                Стол {table.id} · {reservation.timeFrom} – {reservation.timeTo} · {reservation.guestName}
              </div>
              <div className="bk-payment__amount">
                {reservation.depositPrice.toLocaleString('ru-RU')} <span className="bk-payment__rub">₽</span>
              </div>
            </div>

            {/* Rules summary from config */}
            <div className="bk-rules-summary">
              <div className="bk-rules-summary__title">Условия отмены</div>
              {BOOKING_RULES.shortSummary.map((rule, i) => (
                <div key={i} className="bk-rules-summary__item">{rule}</div>
              ))}
            </div>

            {/* Consent checkbox — must not be pre-checked */}
            <label className="bk-consent">
              <input
                type="checkbox"
                className="bk-consent__check"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
              />
              <span className="bk-consent__text">
                {BOOKING_RULES.consentLabel}{' '}
                <Link to={BOOKING_RULES.fullRulesUrl} className="bk-consent__link" target="_blank" rel="noopener">
                  {BOOKING_RULES.consentLinkText}
                </Link>
              </span>
            </label>

            <button className="bk-form-submit" onClick={handlePay} disabled={paying || !agreed}>
              {paying ? 'Обработка...' : `Оплатить ${reservation.depositPrice.toLocaleString('ru-RU')} ₽`}
            </button>
            <button className="bk-form-cancel" onClick={handleCancelPayment}>
              Отменить бронь
            </button>
          </div>
        )}

        {/* Success */}
        {step === 'success' && reservation && (
          <div className="bk-panel__success">
            <div className="bk-panel__success-icon">✓</div>
            <div className="bk-panel__success-title">Бронь подтверждена!</div>
            <div className="bk-panel__success-text">
              Стол {table.id} · {reservation.guestName} · {reservation.timeFrom} – {reservation.timeTo}
            </div>
            {reservation.depositPrice > 0 && (
              <div className="bk-panel__success-deposit">
                Депозит {reservation.depositPrice.toLocaleString('ru-RU')} ₽ — оплачен ✓
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ──────────────────────────── Page ─────────────────────────────
export default function FloorPlanPage() {
  const [date,        setDate]        = useState(todayIso);
  const [time,        setTime]        = useState('19:00');
  const [party,       setParty]       = useState(2);
  const [selId,       setSelId]       = useState(null);
  const [tick,        setTick]        = useState(0);
  const [currentUser, setCurrentUser] = useState(() => AuthService.getCurrentUser());
  // Login opens as an overlay over the floor plan (not a navigate to
  // /auth) so the guest keeps their selected table/date/time.
  const [authOpen, setAuthOpen] = useState(false);

  // Sync auth state when returning from /auth
  useEffect(() => {
    const syncAuth = () => setCurrentUser(AuthService.getCurrentUser());
    window.addEventListener('focus', syncAuth);
    return () => window.removeEventListener('focus', syncAuth);
  }, []);

  // Открыто как Telegram Mini App (бот → «🪑 Открыть» кнопка) — молча логинит
  // через initData. См. src/useTelegramWebApp.js.
  useTelegramWebApp(setCurrentUser);

  const [tables,  setTables]  = useState([]);
  const [loading, setLoading] = useState(true);

  // `silent` refreshes (background polling) keep table statuses live for
  // anyone else viewing the same date/time, without flashing the loading
  // hint or resetting a form the current user is mid-way through filling.
  // requestKeyRef guards against a stale response (e.g. from a poll fired
  // just before the user switched date/time) overwriting fresher data.
  const requestKeyRef = useRef(0);
  const fetchTables = useCallback((opts = {}) => {
    const { silent = false } = opts;
    const key = ++requestKeyRef.current;
    if (!silent) setLoading(true);
    return BookingService.getTablesWithStatus(date, time)
      .then(t => { if (requestKeyRef.current === key) setTables(t); })
      .catch(() => { if (!silent && requestKeyRef.current === key) setTables([]); })
      .finally(() => { if (!silent && requestKeyRef.current === key) setLoading(false); });
  }, [date, time]);

  useEffect(() => { fetchTables(); }, [fetchTables, tick]);

  useEffect(() => {
    const id = setInterval(() => fetchTables({ silent: true }), LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchTables]);

  const sel = selId ? tables.find(t => t.id === selId) : null;

  function handleBooked() {
    setTick(n => n + 1);
    // Keep the panel open to show success, then close via timer in InfoPanel
    setTimeout(() => setSelId(null), 3600);
  }

  function openFirstVacant() {
    const first = tables.find(t => t.status === 'vacant');
    if (first) setSelId(first.id);
  }

  const tsScrollRef = useRef(null);

  return (
    <div className="bk-root">

      {/* ── Header ── */}
      <header className="bk-header">
        <Link to="/" className="bk-header__logo">
          <img src="/uploads/logo-icon.svg" alt="The Cat's Pajamas Club" style={{ height: 24, width: 'auto', display: 'block' }} />
          <span className="bk-header__logo-text">CAT'S PAJAMAS</span>
        </Link>
        <div className="bk-header__divider" />
        <span className="bk-header__title">БРОНИРОВАНИЕ СТОЛОВ</span>
        <div className="bk-header__divider" />

        {/* Date navigation */}
        <div className="bk-date-nav">
          <button className="bk-date-nav__btn" onClick={() => setDate(d => shiftDay(d, -1))}>‹</button>
          <DatePicker value={date} onChange={setDate} />
          <button className="bk-date-nav__btn" onClick={() => setDate(d => shiftDay(d, 1))}>›</button>
        </div>

        {/* Time slots */}
        <div className="bk-timeslots" ref={tsScrollRef}>
          {TIME_SLOTS.map(ts => (
            <button
              key={ts}
              className={`bk-ts${ts === time ? ' bk-ts--active' : ''}`}
              onClick={() => { setTime(ts); setSelId(null); }}
            >{ts}</button>
          ))}
        </div>

        {/* Party size */}
        <div className="bk-party">
          <span className="bk-party__lbl">ГОСТЕЙ</span>
          <button className="bk-party__btn" onClick={() => setParty(n => Math.max(1, n - 1))}>−</button>
          <span className="bk-party__num">{party}</span>
          <button className="bk-party__btn" onClick={() => setParty(n => Math.min(12, n + 1))}>+</button>
        </div>

        <button className="bk-new-btn" onClick={openFirstVacant}>Забронировать столик</button>

        {/* Guest-facing header — no staff/account indicator here at all
            (previously showed the logged-in account name + an ADMIN badge,
            which read as an internal tool rather than a guest widget).
            Only a login prompt for guests who aren't signed in yet. */}
        {!currentUser && (
          <button type="button" className="bk-login-btn" onClick={() => setAuthOpen(true)}>Войти</button>
        )}
      </header>

      {/* ── Body ── */}
      <div className="bk-body">
        <Sidebar
          tables={tables}
          selectedTime={time}
          selectedTableId={selId}
          onSelectTable={id => setSelId(id)}
        />

        <div className="bk-main">
          <FloorPlanSvg
            tables={tables}
            selectedTableId={selId}
            onSelect={id => setSelId(id)}
            onDeselect={() => setSelId(null)}
          />

          <Legend />

          {!selId && (
            <div className="bk-hint">
              <span>{loading ? 'Загрузка плана зала…' : 'Нажмите на стол для бронирования'}</span>
            </div>
          )}

          <InfoPanel
            key={selId + tick}
            table={sel}
            date={date}
            time={time}
            onClose={() => setSelId(null)}
            onBooked={handleBooked}
            currentUser={currentUser}
            onRequestAuth={() => setAuthOpen(true)}
          />

          {authOpen && (
            <AuthModal
              subtitle="Чтобы забронировать стол, войдите или создайте аккаунт"
              onClose={() => setAuthOpen(false)}
              onSuccess={() => setCurrentUser(AuthService.getCurrentUser())}
            />
          )}
        </div>
      </div>
    </div>
  );
}
