import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthService from '../auth/AuthService.js';
import BookingService from '../booking/BookingService.js';
import LoyaltyService from '../loyalty/LoyaltyService.js';
import { useFeedback } from '../ui/FeedbackProvider.jsx';
import { usePageMeta } from '../usePageMeta.js';
import './profile.css';

// Личный кабинет — «Карта гостя» (вариант владельца, 2026-08-30).
//
// Было: три вкладки (Профиль · Мои брони · Уровень) на четыре поля данных.
// Стартовая вкладка показывала телефон, telegram и поле имени — и 900 пикселей
// пустоты, а то, ради чего гость сюда заходит (когда моя бронь и какой у меня
// уровень), пряталось за кликом.
//
// Стало: одна страница-плитка. Сверху карта гостя (имя, уровень, прогресс),
// ниже ближайшая бронь и лестница уровней, дальше остальные брони и свёрнутая
// история. Пустых состояний нет: без броней плитка становится приглашением
// забронировать стол.
//
// Вкладок нет, но `?tab=` из Mini App-хаба (/app) остаётся рабочим — теперь он
// не переключает вкладку, а прокручивает к нужной плитке (см. TAB_ANCHORS).

// Только подписи: цвет статуса задаёт класс .prof-status--<ключ> в profile.css.
// Раньше цвет приезжал сюда голым hex'ом и инлайном садился на элемент — это
// прямо против правила проекта «цвета только токенами».
const STATUS_LABELS = {
  pending:   'Ждёт бармена',
  confirmed: 'Подтверждена',
  seated:    'Вы за столом',
  cancelled: 'Отменена',
  completed: 'Завершена',
  no_show:   'Неявка',
};

const DEPOSIT_LABELS = {
  pending:            'ожидает оплаты',
  paid_mock:          'оплачен',
  refunded:           'возвращён',
  partially_retained: 'частично удержан',
};

/** Куда прокручивать по старым deep-link'ам вида /profile?tab=loyalty. */
const TAB_ANCHORS = {
  profile:      'prof-card',
  reservations: 'prof-bookings',
  loyalty:      'prof-level',
};

// Тёплые цвета логобука (золото, светлое золото, пастель) — холодных синих и
// розовых прежней схемы в палитре бара нет.
const AVATAR_COLORS = ['#B08900', '#CBA53A', '#857861'];

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

function Avatar({ user, size = 'sm' }) {
  const color = AVATAR_COLORS[hashStr(user.id) % AVATAR_COLORS.length];
  return (
    <div
      className={`prof-avatar prof-avatar--${size}`}
      style={{ background: color + '22', color, borderColor: color + '55' }}
    >
      {initialsOf(user.name || user.phone)}
    </div>
  );
}

const MONTHS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(d)} ${MONTHS[parseInt(m) - 1]} ${y}`;
}

function isFuture(date, time) {
  const dt = new Date(`${date}T${time}:00`);
  return dt > new Date();
}

function pluralize(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const pluralBookings = (n) => pluralize(n, 'бронь', 'брони', 'броней');

/**
 * «Сегодня» / «Завтра» / «Через 4 дня» для ближайшей брони.
 * Считаем по календарным суткам, а не по разнице в миллисекундах: бронь на
 * завтра в 01:00 — это «завтра», хотя до неё меньше суток.
 */
function whenLabel(dateStr) {
  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const [y, m, d] = dateStr.split('-').map(Number);
  const days = Math.round((midnight(new Date(y, m - 1, d)) - midnight(new Date())) / 86400000);
  if (days < 0) return '';
  if (days === 0) return 'Сегодня';
  if (days === 1) return 'Завтра';
  return `Через ${days} ${pluralize(days, 'день', 'дня', 'дней')}`;
}

/* ─────────────────────────── Плитка ─────────────────────────── */

function Tile({ id, title, count, span = '', className = '', children }) {
  return (
    <section id={id} className={`prof-tile ${span} ${className}`.trim()}>
      {title && (
        <div className="prof-tile__head">
          <span className="prof-tile__title">{title}</span>
          {count != null && <span className="prof-tile__count">{count}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

function Skeleton({ lines = 2 }) {
  return (
    <div className="prof-skeleton-card">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="prof-skeleton-line" style={{ width: `${75 - i * 20}%` }} />
      ))}
    </div>
  );
}

function LoadError({ text, onRetry }) {
  return (
    <div className="prof-empty">
      <div className="prof-empty__icon">⚠</div>
      <p>{text}</p>
      <button className="prof-cta" onClick={onRetry}>Повторить</button>
    </div>
  );
}

/* ─────────────────── Лестница уровней (данные) ─────────────────── */

// 9 уровней по числу подтверждённых броней — зеркало LEVELS из
// api/_lib/loyalty.js (сервер — источник истины, тут только подписи лестницы).
const LEVELS = [
  { num: 1, label: 'Шампанское', emoji: '🍾', min: 0 },
  { num: 2, label: 'Вино',       emoji: '🍷', min: 1 },
  { num: 3, label: 'Вермут',     emoji: '🫒', min: 3 },
  { num: 4, label: 'Джин',       emoji: '🍸', min: 5 },
  { num: 5, label: 'Ром',        emoji: '🍹', min: 10 },
  { num: 6, label: 'Текила',     emoji: '🌵', min: 15 },
  { num: 7, label: 'Виски',      emoji: '🥃', min: 20 },
  { num: 8, label: 'Коньяк',     emoji: '👑', min: 25 },
  { num: 9, label: 'Абсент',     emoji: '🧚', min: 50 },
];

function LevelLadder({ loyalty }) {
  const current = loyalty?.level?.num ?? 0;
  return (
    <div className="prof-ladder">
      {LEVELS.map(l => (
        <div
          key={l.num}
          className={`prof-ladder__row${l.num === current ? ' prof-ladder__row--current' : ''}${l.num <= current ? ' prof-ladder__row--reached' : ''}`}
        >
          <span className="prof-ladder__emoji">{l.emoji}</span>
          <span className="prof-ladder__label">{l.num}. {l.label}</span>
          <span className="prof-ladder__req">
            {l.min === 0 ? 'за регистрацию' : `${l.min} ${pluralBookings(l.min)}`}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────── Карта гостя ─────────────────────── */

/**
 * Верхняя плитка: кто гость и на какой он ступени. Имя правится тут же — ради
 * одного поля отдельная вкладка «Профиль» не нужна, а телефон и telegram ушли
 * в подпись под именем: смотреть их нужно раз в жизни.
 */
function GuestCard({ user, onSaved, loyalty, loyaltyError, onRetryLoyalty }) {
  const { toast } = useFeedback();
  const [nameEdit, setNameEdit] = useState(user.name || '');
  const [editing,  setEditing]  = useState(false);
  const [saving,   setSaving]   = useState(false);

  const phone = user.phone
    ? `+${user.phone.replace(/(\d)(\d{3})(\d{3})(\d{2})(\d{2})/, '$1 ($2) $3-$4-$5')}`
    : '';

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      onSaved(await AuthService.updateProfile({ name: nameEdit }));
      setEditing(false);
      toast.success('Имя сохранено');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const level = loyalty?.level;
  const segStart = level ? (LEVELS[level.num - 1]?.min ?? 0) : 0;
  const progressPct = !loyalty ? 0 : loyalty.next
    ? Math.max(0, Math.min(100, Math.round(
        ((loyalty.bookings - segStart) / Math.max(1, loyalty.next.minBookings - segStart)) * 100)))
    : 100;

  return (
    <Tile id="prof-card" span="prof-tile--full" className="prof-card">
      <Avatar user={user} size="lg" />

      <div className="prof-card__main">
        {editing ? (
          <form className="prof-card__nameform" onSubmit={handleSave}>
            <input
              className="prof-input" type="text" autoFocus
              value={nameEdit} onChange={e => setNameEdit(e.target.value)}
              placeholder="Ваше имя" aria-label="Ваше имя"
            />
            <button className="prof-save-btn" type="submit" disabled={saving}>
              {saving ? '…' : 'Сохранить'}
            </button>
            <button
              className="prof-ghost-btn" type="button"
              onClick={() => { setEditing(false); setNameEdit(user.name || ''); }}
            >
              Отмена
            </button>
          </form>
        ) : (
          <h1 className="prof-card__name">
            {user.name || 'Гость'}
            <button className="prof-ghost-btn" type="button" onClick={() => setEditing(true)}>
              {user.name ? 'Изменить' : 'Представиться'}
            </button>
          </h1>
        )}

        <p className="prof-card__contacts">
          {phone && <span>{phone}</span>}
          {user.telegramId && <span>Telegram ID {user.telegramId}</span>}
        </p>
      </div>

      <div className="prof-card__level">
        {loyaltyError && <LoadError text="Уровень не загрузился." onRetry={onRetryLoyalty} />}
        {!loyaltyError && !loyalty && <Skeleton lines={2} />}
        {!loyaltyError && loyalty && (
          <>
            <div className="prof-card__tier">
              <span className="prof-card__tier-emoji">{level.emoji}</span>
              <span className="prof-card__tier-name">{level.label}</span>
              <span className="prof-card__tier-num">Уровень {level.num} из 9</span>
            </div>
            <div className="prof-loyalty__bar">
              <div className="prof-loyalty__bar-fill" style={{ width: progressPct + '%' }} />
            </div>
            <p className="prof-card__tier-next">
              {loyalty.bookings} {pluralBookings(loyalty.bookings)} подтверждено.{' '}
              {loyalty.next
                ? `До «${loyalty.next.label}» ${loyalty.next.emoji} — ещё ${loyalty.next.remaining} ${pluralBookings(loyalty.next.remaining)}.`
                : 'Вы на вершине лестницы 🥂'}
            </p>
          </>
        )}
      </div>
    </Tile>
  );
}

/* ─────────────────────── Карточка брони ─────────────────────── */

function ReservationCard({ r, featured = false, onCancel, onPay, busyCancel, busyPay }) {
  const canCancel = isFuture(r.date, r.timeFrom) && (r.status === 'confirmed' || r.status === 'pending');
  const when = featured ? whenLabel(r.date) : '';
  return (
    <div className={`prof-res-card${featured ? ' prof-res-card--featured' : ''}`}>
      <div className="prof-res-card__top">
        <div className="prof-res-card__meta">
          <span className="prof-res-card__table">{r.tableId}</span>
          <span className="prof-res-card__date">{formatDate(r.date)}</span>
          <span className="prof-res-card__time">{r.timeFrom} – {r.timeTo}</span>
          <span className="prof-res-card__guests">{r.guestsCount} гост.</span>
        </div>
        <span className={`prof-res-card__status prof-status prof-status--${r.status}`}>
          {STATUS_LABELS[r.status] || STATUS_LABELS.confirmed}
        </span>
      </div>

      {when && <div className="prof-res-card__when">{when}</div>}
      {r.note && <div className="prof-res-card__note">💬 {r.note}</div>}

      {r.depositPrice > 0 && (
        <div className="prof-res-card__deposit">
          <span>Депозит {r.depositPrice} ₽ · {DEPOSIT_LABELS[r.depositStatus] || r.depositStatus}</span>
          {r.depositStatus === 'pending' && (
            <button className="prof-pay-btn" onClick={() => onPay(r)} disabled={busyPay}>
              {busyPay ? 'Оплачиваем…' : `Оплатить ${r.depositPrice} ₽`}
            </button>
          )}
        </div>
      )}

      {canCancel && (
        <button className="prof-cancel-btn" onClick={() => onCancel(r.id)} disabled={busyCancel}>
          {busyCancel ? 'Отменяем…' : 'Отменить бронь'}
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────── Страница ─────────────────────────── */

export default function ProfilePage() {
  usePageMeta({ title: "Профиль — The Cat's Pajamas Club", noindex: true });
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast, confirm } = useFeedback();

  const [user, setUser] = useState(null);
  // Брони и уровень грузит сама страница: «Карта гостя» показывает и то, и
  // другое разом, разносить два запроса по вкладкам больше некуда.
  const [reservations, setReservations] = useState([]);
  const [resLoading,   setResLoading]   = useState(true);
  const [resError,     setResError]     = useState(false);
  const [loyalty,      setLoyalty]      = useState(null);
  const [loyaltyError, setLoyaltyError] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const [payingId,     setPayingId]     = useState(null);

  const loadReservations = useCallback(() => {
    setResLoading(true);
    setResError(false);
    BookingService.getMyReservations()
      .then(setReservations)
      .catch(() => setResError(true))
      .finally(() => setResLoading(false));
  }, []);

  const loadLoyalty = useCallback(() => {
    setLoyaltyError(false);
    LoyaltyService.getStatus()
      .then(d => setLoyalty(d.status))
      .catch(() => setLoyaltyError(true));
  }, []);

  useEffect(() => {
    const u = AuthService.getCurrentUser();
    if (!u) { navigate('/auth?next=/profile', { replace: true }); return; }
    setUser(u);
    loadReservations();
    loadLoyalty();
  }, []);

  // Старые deep-link'и из Mini App-хаба (/profile?tab=loyalty) вкладок больше
  // не находят — прокручиваем к соответствующей плитке, чтобы ссылки в боте и
  // в /app продолжали вести туда, куда обещают.
  useEffect(() => {
    const anchor = TAB_ANCHORS[searchParams.get('tab')];
    if (!anchor || !user) return;
    const el = document.getElementById(anchor);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [user, searchParams]);

  const { upcoming, otherActive, past } = useMemo(() => {
    const done = new Set(['cancelled', 'completed', 'no_show']);
    const active = reservations.filter(r => !done.has(r.status));
    // Ближайшая — самая ранняя из ещё не наступивших; если все в прошлом
    // (бармен не закрыл вчерашнюю бронь), выносить наверх нечего.
    const first = active
      .filter(r => isFuture(r.date, r.timeFrom))
      .sort((a, b) => (a.date + a.timeFrom).localeCompare(b.date + b.timeFrom))[0] || null;
    return {
      upcoming: first,
      otherActive: active.filter(r => r !== first),
      past: reservations.filter(r => done.has(r.status)),
    };
  }, [reservations]);

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
      loadLoyalty(); // уровень считается по подтверждённым броням — он мог просесть
      toast.success('Бронь отменена');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setCancellingId(null);
    }
  }

  // Демо-оплата депозита (мок-провайдер, без реального эквайринга) —
  // подтверждение брони это НЕ заменяет, его делает бармен.
  async function handlePayDeposit(r) {
    const ok = await confirm({
      title: 'Оплатить депозит?',
      message: `Депозит ${r.depositPrice} ₽ за стол ${r.tableId}. Демо-оплата: спишется мгновенно и засчитается в счёт заказа при визите.`,
      confirmLabel: `Оплатить ${r.depositPrice} ₽`,
    });
    if (!ok) return;
    setPayingId(r.id);
    try {
      await BookingService.payDeposit(r.id);
      loadReservations();
      toast.success('Депозит оплачен — барменам уже видно');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setPayingId(null);
    }
  }

  function handleLogout() {
    AuthService.logout();
    navigate('/', { replace: true });
  }

  if (!user) return null;

  const cardProps = { onCancel: handleCancel, onPay: handlePayDeposit };

  return (
    <div className="prof-root" data-theme="A">
      <header className="prof-header">
        <Link to="/" className="prof-header__logo">
          <img src="/uploads/logo-icon.svg" alt="The Cat's Pajamas Club" style={{ height: 24, width: 'auto', display: 'block' }} />
          <span className="prof-header__logo-text">CAT'S PAJAMAS</span>
        </Link>
        <div className="prof-header__divider" />
        <span className="prof-header__title">ЛИЧНЫЙ КАБИНЕТ</span>
        <div style={{ flex: 1 }} />
        <Link to="/booking" className="prof-header__link">← К плану зала</Link>
        <button className="prof-header__logout" onClick={handleLogout}>Выйти</button>
      </header>

      <main className="prof-main">
        <div className="prof-bento">

          <GuestCard
            user={user}
            onSaved={setUser}
            loyalty={loyalty}
            loyaltyError={loyaltyError}
            onRetryLoyalty={loadLoyalty}
          />

          {/* Две колонки-стопки, а не свободная раскладка плиток по сетке:
              высота лестницы уровней вдвое больше карточки брони, и при
              обычной автораскладке под бронью зияла бы дыра в ряд высотой. */}
          <div className="prof-col">
          {/* Ближайшая бронь — то, ради чего гость чаще всего сюда заходит,
              поэтому она отдельной плиткой, а не строкой в общем списке. */}
          <Tile id="prof-bookings" title="БЛИЖАЙШАЯ БРОНЬ">
            {resLoading && <Skeleton lines={3} />}
            {!resLoading && resError && <LoadError text="Не удалось загрузить брони." onRetry={loadReservations} />}
            {!resLoading && !resError && !upcoming && (
              <div className="prof-empty">
                <p>Столик пока не забронирован — ближайший вечер ещё можно занять.</p>
                <Link to="/booking" className="prof-cta">Забронировать стол</Link>
              </div>
            )}
            {!resLoading && !resError && upcoming && (
              <ReservationCard
                r={upcoming} featured {...cardProps}
                busyCancel={cancellingId === upcoming.id}
                busyPay={payingId === upcoming.id}
              />
            )}
          </Tile>

          {otherActive.length > 0 && (
            <Tile title="ДРУГИЕ БРОНИ" count={otherActive.length}>
              <div className="prof-res-list">
                {otherActive.map(r => (
                  <ReservationCard
                    key={r.id} r={r} {...cardProps}
                    busyCancel={cancellingId === r.id}
                    busyPay={payingId === r.id}
                  />
                ))}
              </div>
            </Tile>
          )}
          </div>

          <div className="prof-col prof-col--side">
            <Tile id="prof-level" title="ЛЕСТНИЦА УРОВНЕЙ">
              <LevelLadder loyalty={loyalty} />
            </Tile>
          </div>

          {past.length > 0 && (
            <Tile span="prof-tile--full" className="prof-tile--history">
              <details className="prof-history">
                <summary className="prof-history__summary">
                  <span className="prof-tile__title">ИСТОРИЯ ВИЗИТОВ</span>
                  <span className="prof-tile__count">{past.length}</span>
                </summary>
                <div className="prof-res-list prof-res-list--past">
                  {past.map(r => (
                    <div key={r.id} className="prof-res-card prof-res-card--past">
                      <div className="prof-res-card__top">
                        <div className="prof-res-card__meta">
                          <span className="prof-res-card__table">{r.tableId}</span>
                          <span className="prof-res-card__date">{formatDate(r.date)}</span>
                          <span className="prof-res-card__time">{r.timeFrom} – {r.timeTo}</span>
                        </div>
                        <span className={`prof-res-card__status prof-status prof-status--${r.status}`}>
                          {STATUS_LABELS[r.status] || STATUS_LABELS.completed}
                        </span>
                      </div>
                      {r.cancellationReason && (
                        <div className="prof-res-card__note">{r.cancellationReason}</div>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            </Tile>
          )}

        </div>
      </main>
    </div>
  );
}
