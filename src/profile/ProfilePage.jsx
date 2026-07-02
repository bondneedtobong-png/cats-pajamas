import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthService from '../auth/AuthService.js';
import BookingService from '../booking/BookingService.js';
import LoyaltyService from '../loyalty/LoyaltyService.js';
import { useFeedback } from '../ui/FeedbackProvider.jsx';
import './profile.css';

const STATUS_LABELS = {
  pending:   { text: 'Ожидает',  color: '#D4A843' },
  confirmed: { text: 'Активна',  color: '#22c55e' },
  cancelled: { text: 'Отменена', color: '#6b7280' },
  completed: { text: 'Завершена',color: '#9B5DE5' },
  no_show:   { text: 'Неявка',   color: '#f87171' },
};

const TABS = [
  { key: 'profile',      label: 'Профиль' },
  { key: 'reservations', label: 'Мои брони' },
  { key: 'loyalty',      label: 'Уровень' },
];

const AVATAR_COLORS = ['#9B5DE5', '#D4A843', '#22c55e', '#f87171', '#3b82f6', '#ec4899'];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initialsOf(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function Avatar({ user }) {
  const color = AVATAR_COLORS[hashStr(user.id) % AVATAR_COLORS.length];
  return (
    <div className="prof-avatar" style={{ background: color + '22', color, borderColor: color + '55' }}>
      {initialsOf(user.name || user.phone)}
    </div>
  );
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

function isFuture(date, time) {
  const dt = new Date(`${date}T${time}:00`);
  return dt > new Date();
}

// ─────────────────────────── Tab: Профиль ───────────────────────────
function ProfileTab({ user, onSaved }) {
  const { toast } = useFeedback();
  const [nameEdit,  setNameEdit]  = useState(user.name || '');
  const [nameSaved, setNameSaved] = useState(false);

  const phone = user.phone ? `+${user.phone.replace(/(\d)(\d{3})(\d{3})(\d{2})(\d{2})/, '$1 ($2) $3-$4-$5')}` : '';

  async function handleSaveName(e) {
    e.preventDefault();
    try {
      const updated = await AuthService.updateProfile({ name: nameEdit });
      onSaved(updated);
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <section className="prof-section">
      <div className="prof-section__head">
        <span className="prof-section__title">ПРОФИЛЬ</span>
      </div>
      <form className="prof-profile-form" onSubmit={handleSaveName}>
        {phone && (
          <div className="prof-field">
            <div className="prof-field__lbl">ТЕЛЕФОН</div>
            <div className="prof-field__val">{phone}</div>
          </div>
        )}
        {user.telegramId && (
          <div className="prof-field">
            <div className="prof-field__lbl">TELEGRAM</div>
            <div className="prof-field__val">ID: {user.telegramId}</div>
          </div>
        )}
        <div className="prof-field">
          <label className="prof-field__lbl" htmlFor="prof-name">ИМЯ</label>
          <div className="prof-name-row">
            <input
              id="prof-name"
              className="prof-input"
              type="text"
              value={nameEdit}
              onChange={e => setNameEdit(e.target.value)}
              placeholder="Ваше имя"
            />
            <button className="prof-save-btn" type="submit">
              {nameSaved ? '✓' : 'Сохранить'}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

// ─────────────────────────── Tab: Мои брони ───────────────────────────
function ReservationsTab() {
  const { toast, confirm } = useFeedback();
  const [reservations, setReservations] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [loadError,    setLoadError]    = useState(false);
  const [cancellingId, setCancellingId] = useState(null);

  function loadReservations() {
    setLoading(true);
    setLoadError(false);
    BookingService.getMyReservations()
      .then(setReservations)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }

  useEffect(loadReservations, []);

  async function handleCancel(id) {
    const ok = await confirm({
      title: 'Отменить бронирование?',
      message: 'Стол снова станет доступен для других гостей.',
      confirmLabel: 'Отменить бронь',
      danger: true,
    });
    if (!ok) return;
    setCancellingId(id);
    try {
      await BookingService.cancelReservation(id, 'Отменено гостем через личный кабинет');
      loadReservations();
      toast.success('Бронь отменена');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setCancellingId(null);
    }
  }

  if (loading) {
    return (
      <section className="prof-section">
        <div className="prof-skeleton-list">
          {[0, 1].map(i => (
            <div key={i} className="prof-skeleton-card">
              <div className="prof-skeleton-line" style={{ width: '60%' }} />
              <div className="prof-skeleton-line" style={{ width: '40%' }} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="prof-section">
        <div className="prof-empty">
          <div className="prof-empty__icon">⚠</div>
          <p>Не удалось загрузить брони — проверьте соединение.</p>
          <button className="prof-cta" onClick={loadReservations}>Повторить</button>
        </div>
      </section>
    );
  }

  const activeRes = reservations.filter(r => r.status !== 'cancelled' && r.status !== 'completed' && r.status !== 'no_show');
  const pastRes   = reservations.filter(r => r.status === 'cancelled' || r.status === 'completed' || r.status === 'no_show');

  return (
    <>
      <section className="prof-section">
        <div className="prof-section__head">
          <span className="prof-section__title">МОИ БРОНИ</span>
          <span className="prof-section__count">{activeRes.length}</span>
        </div>

        {activeRes.length === 0 ? (
          <div className="prof-empty">
            <div className="prof-empty__icon">○</div>
            <p>Нет активных бронирований</p>
            <Link to="/booking" className="prof-cta">Забронировать стол</Link>
          </div>
        ) : (
          <div className="prof-res-list">
            {activeRes.map(r => {
              const st = STATUS_LABELS[r.status] || STATUS_LABELS.confirmed;
              const canCancel = isFuture(r.date, r.timeFrom) && (r.status === 'confirmed' || r.status === 'pending');
              return (
                <div key={r.id} className="prof-res-card">
                  <div className="prof-res-card__top">
                    <div className="prof-res-card__meta">
                      <span className="prof-res-card__table">{r.tableId}</span>
                      <span className="prof-res-card__date">{formatDate(r.date)}</span>
                      <span className="prof-res-card__time">{r.timeFrom} – {r.timeTo}</span>
                      <span className="prof-res-card__guests">{r.guestsCount} гост.</span>
                    </div>
                    <span
                      className="prof-res-card__status"
                      style={{ color: st.color, borderColor: st.color + '44', background: st.color + '12' }}
                    >
                      {st.text}
                    </span>
                  </div>
                  {r.note && <div className="prof-res-card__note">💬 {r.note}</div>}
                  {canCancel && (
                    <button
                      className="prof-cancel-btn"
                      onClick={() => handleCancel(r.id)}
                      disabled={cancellingId === r.id}
                    >
                      {cancellingId === r.id ? 'Отменяем…' : 'Отменить бронь'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {pastRes.length > 0 && (
        <section className="prof-section">
          <div className="prof-section__head">
            <span className="prof-section__title">ИСТОРИЯ</span>
            <span className="prof-section__count">{pastRes.length}</span>
          </div>
          <div className="prof-res-list prof-res-list--past">
            {pastRes.map(r => {
              const st = STATUS_LABELS[r.status] || STATUS_LABELS.completed;
              return (
                <div key={r.id} className="prof-res-card prof-res-card--past">
                  <div className="prof-res-card__top">
                    <div className="prof-res-card__meta">
                      <span className="prof-res-card__table">{r.tableId}</span>
                      <span className="prof-res-card__date">{formatDate(r.date)}</span>
                      <span className="prof-res-card__time">{r.timeFrom} – {r.timeTo}</span>
                    </div>
                    <span
                      className="prof-res-card__status"
                      style={{ color: st.color, borderColor: st.color + '44', background: st.color + '12' }}
                    >
                      {st.text}
                    </span>
                  </div>
                  {r.cancellationReason && (
                    <div className="prof-res-card__note">{r.cancellationReason}</div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

// ─────────────────────────── Tab: Уровень ───────────────────────────
function LoyaltyTab() {
  const { toast } = useFeedback();
  const [status,     setStatus]     = useState(null);
  const [todaySpin,  setTodaySpin]  = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState(false);
  const [spinning,   setSpinning]   = useState(false);

  function load() {
    setLoading(true);
    setLoadError(false);
    LoyaltyService.getStatus()
      .then(d => { setStatus(d.status); setTodaySpin(d.todaySpin); })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleSpin() {
    setSpinning(true);
    try {
      const result = await LoyaltyService.spin();
      await new Promise(r => setTimeout(r, 1500)); // let the spin animation play out
      setTodaySpin({ prize_label: result.prize.label, redeemed: !result.prize.redeem });
      if (result.prize.points) {
        setStatus(s => s && ({ ...s, points: s.points + result.prize.points }));
      }
      toast.success(result.prize.label);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSpinning(false);
    }
  }

  if (loading) {
    return (
      <section className="prof-section">
        <div className="prof-skeleton-list">
          <div className="prof-skeleton-card">
            <div className="prof-skeleton-line" style={{ width: '50%' }} />
            <div className="prof-skeleton-line" style={{ width: '80%' }} />
          </div>
        </div>
      </section>
    );
  }

  if (loadError || !status) {
    return (
      <section className="prof-section">
        <div className="prof-empty">
          <div className="prof-empty__icon">⚠</div>
          <p>Не удалось загрузить уровень.</p>
          <button className="prof-cta" onClick={load}>Повторить</button>
        </div>
      </section>
    );
  }

  const { points, tier, next } = status;
  const span = next ? Math.max(1, next.min - tier.min) : 1;
  const progressPct = next ? Math.min(100, Math.round(((points - tier.min) / span) * 100)) : 100;

  return (
    <section className="prof-section">
      <div className="prof-section__head">
        <span className="prof-section__title">УРОВЕНЬ</span>
      </div>

      <div className="prof-loyalty">
        <div className="prof-loyalty__tier-row">
          <span className="prof-loyalty__tier-label">{tier.label}</span>
          <span className="prof-loyalty__points">{points} баллов</span>
        </div>
        <div className="prof-loyalty__bar">
          <div className="prof-loyalty__bar-fill" style={{ width: progressPct + '%' }} />
        </div>
        <p className="prof-loyalty__next">
          {next ? `До «${next.label}» — ${next.min - points} баллов` : 'Вы достигли максимального уровня 👑'}
        </p>

        <div className="prof-wheel">
          <div className={`prof-wheel__dial${spinning ? ' prof-wheel__dial--spinning' : ''}`}>🎡</div>
          {todaySpin ? (
            <div className="prof-wheel__result">
              <div className="prof-wheel__result-label">Сегодняшний приз</div>
              <div className="prof-wheel__result-prize">{todaySpin.prize_label}</div>
              {!todaySpin.redeemed && <div className="prof-wheel__result-hint">Покажите это барменам, чтобы получить приз</div>}
            </div>
          ) : (
            <button className="prof-wheel__btn" onClick={handleSpin} disabled={spinning}>
              {spinning ? 'Крутим…' : '🎡 Крутить колесо дня'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────── Page ───────────────────────────────
export default function ProfilePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [tab,  setTab]  = useState('profile');

  useEffect(() => {
    const u = AuthService.getCurrentUser();
    if (!u) { navigate('/auth?next=/profile', { replace: true }); return; }
    setUser(u);
  }, []);

  function handleLogout() {
    AuthService.logout();
    navigate('/', { replace: true });
  }

  if (!user) return null;

  return (
    <div className="prof-root">
      <header className="prof-header">
        <Link to="/booking" className="prof-header__logo">
          <img src="/uploads/logo-icon.svg" alt="The Cat's Pajamas Club" style={{ height: 24, width: 'auto', display: 'block' }} />
          <span className="prof-header__logo-text">CAT'S PAJAMAS</span>
        </Link>
        <div className="prof-header__divider" />
        <span className="prof-header__title">ЛИЧНЫЙ КАБИНЕТ</span>
        <div style={{ flex: 1 }} />
        <Avatar user={user} />
        <Link to="/booking" className="prof-header__link">← К плану зала</Link>
        <button className="prof-header__logout" onClick={handleLogout}>Выйти</button>
      </header>

      <main className="prof-main">
        <div className="prof-container">

          <div className="prof-tabs">
            {TABS.map(t => (
              <button
                key={t.key}
                className={`prof-tab${tab === t.key ? ' prof-tab--active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'profile'      && <ProfileTab user={user} onSaved={setUser} />}
          {tab === 'reservations' && <ReservationsTab />}
          {tab === 'loyalty'      && <LoyaltyTab />}

        </div>
      </main>
    </div>
  );
}
