import { useState, useEffect, useRef, useCallback } from 'react';
import BookingService from './BookingService.js';
import AuthService from '../auth/AuthService.js';
import AuthModal from '../auth/AuthModal.jsx';
import FloorPlanSvg from './FloorPlanSvg.jsx';
import { upcomingEveningDates, buildTimeSlots } from './barTime.js';
import { useFeedback } from '../ui/FeedbackProvider.jsx';
import './booking.css';

/**
 * Бронирование v2 — общий виджет «план зала + дата/время прихода + панель
 * стола + форма заявки». Живёт в двух местах:
 *  - страница книги «Бронирование» на главной (variant="book");
 *  - /booking — тонкая standalone-обёртка для Mini App бота и старых ссылок.
 *
 * Модель «бронь по факту»: гость выбирает только дату и время прихода,
 * без времени окончания. Заявку подтверждает бармен (pending → confirmed),
 * о чём гостю честно написано до и после отправки.
 *
 * `active` — виджет на видимой странице книги: все 8 страниц смонтированы
 * одновременно, поллинг статусов (20–30 с по ТЗ) идёт только на открытой.
 * `authTick` — пинок от standalone-обёртки после тихого входа Mini App.
 */
const POLL_MS = 25000;
const BAR_PHONE = { href: 'tel:+79084180009', label: '+7 (908) 418-00-09' };

const TYPE_KEY = { round: 'bkTypeRound', square: 'bkTypeSquare', booth: 'bkTypeBooth' };

function tableTitle(t, tx) {
  return `${tx[TYPE_KEY[t.type]] || ''} №${t.num ?? ''}`.trim();
}

function isValidPhone(value) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11;
}

function DateChips({ dates, value, onChange, tx }) {
  const label = (d, i) => {
    if (i === 0) return tx.bkToday;
    if (i === 1) return tx.bkTomorrow;
    const [, m, day] = d.split('-');
    return `${day}.${m}`;
  };
  return (
    <div className="bkw__chips" role="group" aria-label={tx.bkDateLabel}>
      {dates.map((d, i) => (
        <button
          key={d}
          type="button"
          className={`bkw__chip${d === value ? ' bkw__chip--on' : ''}`}
          onClick={() => onChange(d)}
        >{label(d, i)}</button>
      ))}
    </div>
  );
}

function TimeChips({ slots, value, onChange, tx }) {
  if (!slots.length) return <div className="bkw__closed">{tx.bkClosedToday}</div>;
  return (
    <div className="bkw__chips" role="group" aria-label={tx.bkTimeLabel}>
      {slots.map(t => (
        <button
          key={t}
          type="button"
          className={`bkw__chip${t === value ? ' bkw__chip--on' : ''}`}
          onClick={() => onChange(t)}
        >{t}</button>
      ))}
    </div>
  );
}

function Legend({ tx }) {
  const items = [
    ['bkw__dot--vacant', tx.bkLegendVacant],
    ['bkw__dot--reserved', tx.bkLegendReserved],
    ['bkw__dot--occupied', tx.bkLegendOccupied],
  ];
  return (
    <div className="bkw__legend">
      {items.map(([cls, label]) => (
        <span key={cls} className="bkw__legend-item">
          <span className={`bkw__dot ${cls}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

// Панель справа от плана: состояние выбранного стола / форма заявки /
// экран «заявка отправлена». Депозитов и времени окончания в v2 нет.
function Panel({ table, date, time, tx, currentUser, onRequestAuth, onSubmitted, success, onSuccessOk }) {
  const { toast } = useFeedback();
  const [name, setName] = useState(currentUser?.name || '');
  const [phone, setPhone] = useState(currentUser?.phone ? '+' + currentUser.phone : '');
  const [guests, setGuests] = useState('2');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setName(currentUser?.name || '');
    setPhone(currentUser?.phone ? '+' + currentUser.phone : '');
  }, [currentUser?.id]);

  useEffect(() => {
    setGuests(String(Math.min(2, table?.activeSeatsCount || 2)));
    setNote('');
  }, [table?.id]);

  async function handleSubmit() {
    if (!name.trim()) { toast.error(tx.bkFormName.replace(' *', '')); return; }
    setSending(true);
    try {
      const res = await BookingService.createReservation({
        tableId: table.id, date, timeFrom: time,
        guestsCount: parseInt(guests || '2', 10),
        guestName: name, guestPhone: phone, note,
      });
      onSubmitted(res);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSending(false);
    }
  }

  if (success) {
    return (
      <div className="bkw__panel">
        <div className="bkw__success">
          <div className="bkw__success-icon">📨</div>
          <div className="bkw__success-title">{tx.bkSuccessTitle}</div>
          <p className="bkw__success-text">{tx.bkSuccessText}</p>
          <p className="bkw__success-where">{tx.bkSuccessWhere}</p>
          <button type="button" className="bkw__submit" onClick={onSuccessOk}>{tx.bkSuccessOk}</button>
        </div>
      </div>
    );
  }

  if (!table) {
    return (
      <div className="bkw__panel bkw__panel--empty">
        <div className="bkw__hint-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="3.4" />
          </svg>
        </div>
        <p className="bkw__hint-text">{tx.bkPanelHint}</p>
        <p className="bkw__phone-note">
          {tx.bkPanelPhone}<br />
          <a href={BAR_PHONE.href}>{BAR_PHONE.label}</a>
        </p>
      </div>
    );
  }

  const statusText = table.status === 'vacant' ? tx.bkStatusVacant
    : table.status === 'occupied' ? tx.bkStatusOccupied
    : `${tx.bkStatusReservedAt} ${table.reservation?.timeFrom || ''}`.trim();

  return (
    <div className="bkw__panel">
      <div className="bkw__table-head">
        <div>
          <div className="bkw__table-title">{tableTitle(table, tx)}</div>
          <div className="bkw__table-meta">{table.zone} · {table.activeSeatsCount} {tx.bkSeatsLabel}</div>
        </div>
        <span className={`bkw__badge bkw__badge--${table.status}`}>{statusText}</span>
      </div>

      {table.status !== 'vacant' && (
        <p className="bkw__busy-text">
          {table.status === 'occupied' ? tx.bkOccupiedText : tx.bkReservedText}
        </p>
      )}

      {table.status === 'vacant' && !currentUser && (
        <div className="bkw__auth">
          <p className="bkw__auth-text">{tx.bkAuthText}</p>
          <button type="button" className="bkw__submit" onClick={onRequestAuth}>{tx.bkAuthBtn}</button>
          <p className="bkw__phone-note">
            {tx.bkPanelPhone} <a href={BAR_PHONE.href}>{BAR_PHONE.label}</a>
          </p>
        </div>
      )}

      {table.status === 'vacant' && currentUser && (
        <div className="bkw__form">
          <label className="bkw__field">
            <span className="bkw__label">{tx.bkFormName}</span>
            <input className="bkw__input" type="text" value={name} onChange={e => setName(e.target.value)} />
          </label>
          <div className="bkw__row">
            <label className="bkw__field">
              <span className="bkw__label">{tx.bkFormPhone}</span>
              <input
                className={`bkw__input${phone && !isValidPhone(phone) ? ' bkw__input--warn' : ''}`}
                type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="+7 (900) 000-00-00"
              />
            </label>
            <label className="bkw__field bkw__field--sm">
              <span className="bkw__label">{tx.bkFormGuests}</span>
              <select className="bkw__input" value={guests} onChange={e => setGuests(e.target.value)}>
                {Array.from({ length: Math.max(1, table.activeSeatsCount) }, (_, i) => String(i + 1))
                  .map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <label className="bkw__field">
            <span className="bkw__label">{tx.bkFormNote}</span>
            <textarea className="bkw__input bkw__input--area" rows={2} value={note}
              onChange={e => setNote(e.target.value)} placeholder={tx.bkFormNotePh} />
          </label>
          <button type="button" className="bkw__submit" onClick={handleSubmit} disabled={sending || !time}>
            {sending ? tx.bkFormSubmitting : tx.bkFormSubmit}
          </button>
          <p className="bkw__confirm-note">{tx.bkConfirmNote}</p>
        </div>
      )}
    </div>
  );
}

export default function BookingWidget({ tx, active = true, authTick = 0, variant = 'book' }) {
  const dates = upcomingEveningDates(7);
  const [date, setDate] = useState(dates[0]);
  const slots = buildTimeSlots(date);
  const [time, setTime] = useState(() => (slots.includes('19:00') ? '19:00' : slots[0] || null));
  const [selId, setSelId] = useState(null);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(null);
  const [currentUser, setCurrentUser] = useState(() => AuthService.getCurrentUser());
  const [authOpen, setAuthOpen] = useState(false);

  // выбранная дата сменилась → слоты пересобрались; чиним невалидное время
  useEffect(() => {
    const s = buildTimeSlots(date);
    setTime(prev => (s.includes(prev) ? prev : (s.includes('19:00') ? '19:00' : s[0] || null)));
  }, [date]);

  // тихий вход Mini App в standalone-обёртке / возврат с вкладки авторизации
  useEffect(() => { setCurrentUser(AuthService.getCurrentUser()); }, [authTick]);
  useEffect(() => {
    const sync = () => setCurrentUser(AuthService.getCurrentUser());
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, []);

  // Статусы столов: подгрузка при открытии/смене даты + фоновый поллинг
  // 25 с (только на активной странице) + сразу после действий пользователя.
  // requestKeyRef защищает от гонки устаревшего ответа со свежим.
  const requestKeyRef = useRef(0);
  const fetchTables = useCallback((opts = {}) => {
    const { silent = false } = opts;
    const key = ++requestKeyRef.current;
    if (!silent) setLoading(true);
    return BookingService.getTablesWithStatus(date)
      .then(t => { if (requestKeyRef.current === key) setTables(t); })
      .catch(() => { if (!silent && requestKeyRef.current === key) setTables([]); })
      .finally(() => { if (!silent && requestKeyRef.current === key) setLoading(false); });
  }, [date]);

  useEffect(() => { if (active) fetchTables(); }, [fetchTables, active]);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => fetchTables({ silent: true }), POLL_MS);
    return () => clearInterval(id);
  }, [fetchTables, active]);

  const sel = selId ? tables.find(t => t.id === selId) : null;

  function handleSubmitted(res) {
    setSuccess(res);
    setSelId(null);
    fetchTables({ silent: true });
  }

  const planTx = {
    statusVacant: tx.bkStatusVacant,
    statusReservedAt: tx.bkStatusReservedAt,
    statusOccupied: tx.bkStatusOccupied,
    barNote: tx.bkBarNote,
  };

  return (
    <div className={`bkw bkw--${variant}`}>
      <div className="bkw__controls">
        <span className="bkw__ctl-label">{tx.bkDateLabel}</span>
        <DateChips dates={dates} value={date} onChange={d => { setDate(d); setSelId(null); }} tx={tx} />
        <span className="bkw__ctl-label">{tx.bkTimeLabel}</span>
        <TimeChips slots={slots} value={time} onChange={setTime} tx={tx} />
      </div>

      <div className="bkw__body">
        <div className="bkw__plan">
          <FloorPlanSvg
            tables={tables}
            selectedTableId={selId}
            onSelect={id => { setSelId(id); setSuccess(null); }}
            onDeselect={() => setSelId(null)}
            tx={planTx}
          />
          {loading && <div className="bkw__loading">{tx.bkLoading}</div>}
          <Legend tx={tx} />
        </div>

        <Panel
          table={sel}
          date={date}
          time={time}
          tx={tx}
          currentUser={currentUser}
          onRequestAuth={() => setAuthOpen(true)}
          onSubmitted={handleSubmitted}
          success={success}
          onSuccessOk={() => setSuccess(null)}
        />
      </div>

      {authOpen && (
        <AuthModal
          subtitle={tx.bkAuthText}
          onClose={() => setAuthOpen(false)}
          onSuccess={() => setCurrentUser(AuthService.getCurrentUser())}
        />
      )}
    </div>
  );
}
