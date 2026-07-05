import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthService from '../auth/AuthService.js';
import BookingService from '../booking/BookingService.js';
import FloorPlanSvg from '../booking/FloorPlanSvg.jsx';
import { upcomingEveningDates } from '../booking/barTime.js';
import '../booking/booking.css';
import CocktailsService from '../menu/CocktailsService.js';
import EventsService from '../events/EventsService.js';
import ReviewsService from '../reviews/ReviewsService.js';
import TeamService from '../team/TeamService.js';
import ApplicationsService from '../team/ApplicationsService.js';
import GuestsService from './GuestsService.js';
import { useFeedback } from '../ui/FeedbackProvider.jsx';
import { usePageMeta } from '../usePageMeta.js';
import './admin.css';

const SOURCE_LABELS = {
  web:           { text: 'Сайт',    color: '#9B5DE5' },
  phone_manual:  { text: 'Звонок',  color: '#D4A843' },
  telegram_bot:  { text: 'Telegram',color: '#0088cc' },
};
const STATUS_LABELS = {
  pending:   { text: 'Ждёт бармена', color: '#D4A843' },
  confirmed: { text: 'Подтверждена', color: '#22c55e' },
  seated:    { text: 'За столом',    color: '#9B5DE5' },
  cancelled: { text: 'Отменена',     color: '#6b7280' },
  completed: { text: 'Завершена',    color: '#7c6bd8' },
  no_show:   { text: 'Неявка',       color: '#f87171' },
};

function todayIso() { return new Date().toISOString().split('T')[0]; }
function formatDate(d) {
  const [y, m, day] = d.split('-');
  const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  return `${parseInt(day)} ${months[parseInt(m)-1]}`;
}
const TIME_OPTS = ['17:00','17:30','18:00','18:30','19:00','19:30','20:00','20:30','21:00','21:30','22:00','22:30','23:00','23:30'];

// ─── Manual booking modal ────────────────────────────────────────
function ManualBookingModal({ adminId, onSaved, onClose }) {
  const [tableOptions, setTableOptions] = useState([]);
  const [tableId,  setTableId]  = useState('');
  useEffect(() => {
    BookingService.getTablesMerged()
      .then(t => { setTableOptions(t); setTableId(prev => prev || t[0]?.id || ''); })
      .catch(() => {});
  }, []);
  const [date,     setDate]     = useState(todayIso());
  const [timeFrom, setTimeFrom] = useState('19:00');
  const [timeTo,   setTimeTo]   = useState('21:00');
  const [name,     setName]     = useState('');
  const [phone,    setPhone]    = useState('');
  const [guests,   setGuests]   = useState('2');
  const [note,     setNote]     = useState('');
  const [err,      setErr]      = useState('');

  async function handleSave(e) {
    e.preventDefault();
    setErr('');
    try {
      await BookingService.createReservation({
        tableId, date, timeFrom, timeTo,
        guestsCount: parseInt(guests) || 2,
        guestName: name, guestPhone: phone, note,
        source: 'phone_manual',
        createdByAdminId: adminId,
      });
      onSaved();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <div className="adm-modal-overlay" onClick={onClose}>
      <div className="adm-modal" onClick={e => e.stopPropagation()}>
        <div className="adm-modal__head">
          <span className="adm-modal__title">Новая бронь (звонок)</span>
          <button className="adm-modal__close" onClick={onClose}>✕</button>
        </div>
        <form className="adm-modal__form" onSubmit={handleSave}>
          <div className="adm-form-row">
            <div className="adm-form-field">
              <label className="adm-form-lbl">СТОЛ</label>
              <select className="adm-form-input" value={tableId} onChange={e => setTableId(e.target.value)}>
                {tableOptions.map(t => <option key={t.id} value={t.id}>{t.id} — {t.name || t.zone}</option>)}
              </select>
            </div>
            <div className="adm-form-field">
              <label className="adm-form-lbl">ДАТА</label>
              <input className="adm-form-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>
          <div className="adm-form-row">
            <div className="adm-form-field">
              <label className="adm-form-lbl">НАЧАЛО</label>
              <select className="adm-form-input" value={timeFrom} onChange={e => setTimeFrom(e.target.value)}>
                {TIME_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="adm-form-field">
              <label className="adm-form-lbl">КОНЕЦ</label>
              <select className="adm-form-input" value={timeTo} onChange={e => setTimeTo(e.target.value)}>
                {TIME_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="adm-form-field">
              <label className="adm-form-lbl">ГОСТЕЙ</label>
              <select className="adm-form-input" value={guests} onChange={e => setGuests(e.target.value)}>
                {['1','2','3','4','5','6','7','8'].map(n => <option key={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">ИМЯ ГОСТЯ *</label>
            <input className="adm-form-input" type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="Иван Иванов" />
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">ТЕЛЕФОН</label>
            <input className="adm-form-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7 (900) 000-00-00" />
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">ПОЖЕЛАНИЯ</label>
            <textarea className="adm-form-input adm-form-textarea" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="День рождения, аллергии..." />
          </div>
          {err && <div className="adm-error">{err}</div>}
          <button className="adm-btn adm-btn--primary" type="submit">Сохранить бронь</button>
        </form>
      </div>
    </div>
  );
}

// ─── Transfer (reschedule) modal ─────────────────────────────────
function TransferModal({ reservation: r, onSaved, onClose }) {
  const [tableOptions, setTableOptions] = useState([]);
  const [tableId,  setTableId]  = useState(r.tableId);
  useEffect(() => { BookingService.getTablesMerged().then(setTableOptions).catch(() => {}); }, []);
  const [date,     setDate]     = useState(r.date);
  const [timeFrom, setTimeFrom] = useState(r.timeFrom);
  const [timeTo,   setTimeTo]   = useState(r.timeTo);
  const [err,      setErr]      = useState('');

  async function handleSave(e) {
    e.preventDefault();
    setErr('');
    try {
      await BookingService.updateReservation(r.id, { tableId, date, timeFrom, timeTo });
      onSaved();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <div className="adm-modal-overlay" onClick={onClose}>
      <div className="adm-modal" onClick={e => e.stopPropagation()}>
        <div className="adm-modal__head">
          <span className="adm-modal__title">Перенести бронь</span>
          <button className="adm-modal__close" onClick={onClose}>✕</button>
        </div>
        <form className="adm-modal__form" onSubmit={handleSave}>
          <div className="adm-modal__res-info">
            <strong>{r.guestName}</strong> · {r.guestPhone || '—'}
          </div>
          <div className="adm-form-row">
            <div className="adm-form-field">
              <label className="adm-form-lbl">СТОЛ</label>
              <select className="adm-form-input" value={tableId} onChange={e => setTableId(e.target.value)}>
                {tableOptions.map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
              </select>
            </div>
            <div className="adm-form-field">
              <label className="adm-form-lbl">ДАТА</label>
              <input className="adm-form-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>
          <div className="adm-form-row">
            <div className="adm-form-field">
              <label className="adm-form-lbl">НАЧАЛО</label>
              <select className="adm-form-input" value={timeFrom} onChange={e => setTimeFrom(e.target.value)}>
                {TIME_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="adm-form-field">
              <label className="adm-form-lbl">КОНЕЦ</label>
              <select className="adm-form-input" value={timeTo} onChange={e => setTimeTo(e.target.value)}>
                {TIME_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          {err && <div className="adm-error">{err}</div>}
          <button className="adm-btn adm-btn--primary" type="submit">Сохранить</button>
        </form>
      </div>
    </div>
  );
}

// ─── Tab: БРОНИ ─────────────────────────────────────────────────
function TabReservations({ adminId }) {
  const { toast } = useFeedback();
  const [filterSource, setFilterSource] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDate,   setFilterDate]   = useState('');
  const [tick,         setTick]         = useState(0);
  const [showNew,      setShowNew]      = useState(false);
  const [transferRes,  setTransferRes]  = useState(null);
  const [confirm,      setConfirm]      = useState(null);

  const [reservations, setReservations] = useState([]);

  useEffect(() => {
    const filters = {};
    if (filterSource) filters.source = filterSource;
    if (filterStatus) filters.status = filterStatus;
    if (filterDate)   filters.date   = filterDate;
    let alive = true;
    BookingService.getReservations(filters)
      .then(list => { if (alive) setReservations(list.sort((a, b) => (a.date + a.timeFrom) < (b.date + b.timeFrom) ? 1 : -1)); })
      .catch(() => { if (alive) setReservations([]); });
    return () => { alive = false; };
  }, [filterSource, filterStatus, filterDate, tick]);

  async function handleStatus(id, newStatus) {
    try {
      await BookingService.updateReservationStatus(id, newStatus);
      setTick(n => n + 1);
    } catch (e) {
      toast.error(e.message);
    }
  }

  function handleCancelClick(id) {
    setConfirm({
      title: 'Отменить бронь?',
      message: 'Стол снова станет доступен для бронирования.',
      confirmLabel: 'Отменить бронь',
      onConfirm: async () => { await handleStatus(id, 'cancelled'); setConfirm(null); },
    });
  }

  return (
    <div className="adm-tab">
      <div className="adm-filters">
        <select className="adm-select" value={filterSource} onChange={e => setFilterSource(e.target.value)}>
          <option value="">Все каналы</option>
          <option value="web">Сайт</option>
          <option value="phone_manual">Звонок</option>
          <option value="telegram_bot">Telegram</option>
        </select>
        <select className="adm-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Все статусы</option>
          <option value="pending">Ждёт бармена</option>
          <option value="confirmed">Подтверждена</option>
          <option value="seated">За столом</option>
          <option value="cancelled">Отменена</option>
          <option value="completed">Завершена</option>
          <option value="no_show">Неявка</option>
        </select>
        <input type="date" className="adm-select" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
        {filterDate && <button className="adm-btn adm-btn--ghost" onClick={() => setFilterDate('')}>✕ дату</button>}
        <div style={{ flex: 1 }} />
        <button className="adm-btn adm-btn--primary" onClick={() => setShowNew(true)}>+ Добавить (звонок)</button>
      </div>

      {reservations.length === 0 ? (
        <div className="adm-empty">Нет броней по выбранным фильтрам</div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Дата</th><th>Время</th><th>Стол</th><th>Гость</th>
                <th>Телефон</th><th>Гостей</th><th>Канал</th><th>Статус</th><th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map(r => {
                const src = SOURCE_LABELS[r.source] || { text: r.source, color: '#888' };
                const st  = STATUS_LABELS[r.status] || { text: r.status, color: '#888' };
                const isActive = ['confirmed', 'pending', 'seated'].includes(r.status);
                return (
                  <tr key={r.id} className={r.status === 'cancelled' ? 'adm-table__row--muted' : ''}>
                    <td>{formatDate(r.date)}</td>
                    <td className="adm-table__time">{r.timeFrom}–{r.timeTo}</td>
                    <td><span className="adm-table__table-id">{r.tableId}</span></td>
                    <td className="adm-table__name">{r.guestName}</td>
                    <td className="adm-table__phone">{r.guestPhone || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{r.guestsCount}</td>
                    <td>
                      <span className="adm-badge" style={{ color: src.color, background: src.color + '18', borderColor: src.color + '44' }}>{src.text}</span>
                    </td>
                    <td>
                      <span className="adm-badge" style={{ color: st.color, background: st.color + '18', borderColor: st.color + '44' }}>{st.text}</span>
                    </td>
                    <td>
                      <div className="adm-actions">
                        {r.status === 'pending' && (
                          <button className="adm-act-btn adm-act-btn--ok" onClick={() => handleStatus(r.id, 'confirmed')} title="Подтвердить">✓</button>
                        )}
                        {isActive && (
                          <>
                            <button className="adm-act-btn adm-act-btn--move" onClick={() => setTransferRes(r)} title="Перенести">⇄</button>
                            <button className="adm-act-btn adm-act-btn--del" onClick={() => handleCancelClick(r.id)} title="Отменить">✕</button>
                          </>
                        )}
                        {r.status === 'confirmed' && (
                          <button className="adm-act-btn adm-act-btn--ok" onClick={() => handleStatus(r.id, 'seated')} title="Гости пришли">🪑</button>
                        )}
                        {(r.status === 'confirmed' || r.status === 'seated') && (
                          <>
                            <button className="adm-act-btn adm-act-btn--done" onClick={() => handleStatus(r.id, 'completed')} title="Гости ушли — завершить (начислит баллы)">●</button>
                            <button className="adm-act-btn adm-act-btn--no" onClick={() => handleStatus(r.id, 'no_show')} title="Не пришли">✗</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <ManualBookingModal adminId={adminId} onSaved={() => { setShowNew(false); setTick(n => n + 1); }} onClose={() => setShowNew(false)} />
      )}
      {transferRes && (
        <TransferModal reservation={transferRes} onSaved={() => { setTransferRes(null); setTick(n => n + 1); }} onClose={() => setTransferRes(null)} />
      )}
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// ─── Tab: МЕНЮ ────────────────────────────────────────────────────
const COCKTAIL_CATEGORIES = [['classics', 'Классика'], ['signature', 'Авторский']];

function CocktailModal({ initial, onSave, onClose }) {
  const [name,        setName]        = useState(initial?.name || '');
  const [category,    setCategory]    = useState(initial?.category || 'classics');
  const [ingredients, setIngredients] = useState(initial?.ingredients || '');
  const [taste,       setTaste]       = useState(initial?.taste || '');
  const [story,       setStory]       = useState(initial?.story || '');
  const [price,       setPrice]       = useState(initial?.price || '');
  const [imageUrl,    setImageUrl]    = useState(initial?.imageUrl || '');
  const [active,      setActive]      = useState(initial?.active !== false);
  const [err,         setErr]         = useState('');
  const [saving,      setSaving]      = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      await onSave({ name, category, ingredients, taste, story, price, imageUrl, active });
    } catch (ex) {
      setErr(ex.message);
      setSaving(false);
    }
  }

  return (
    <div className="adm-modal-overlay" onClick={onClose}>
      <div className="adm-modal" onClick={e => e.stopPropagation()}>
        <div className="adm-modal__head">
          <span className="adm-modal__title">{initial ? 'Редактировать коктейль' : 'Новый коктейль'}</span>
          <button className="adm-modal__close" onClick={onClose}>✕</button>
        </div>
        <form className="adm-modal__form" onSubmit={handleSubmit}>
          <div className="adm-form-row">
            <div className="adm-form-field">
              <label className="adm-form-lbl">НАЗВАНИЕ *</label>
              <input className="adm-form-input" type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="Gimlet" />
            </div>
            <div className="adm-form-field">
              <label className="adm-form-lbl">КАТЕГОРИЯ</label>
              <select className="adm-form-input" value={category} onChange={e => setCategory(e.target.value)}>
                {COCKTAIL_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">ИНГРЕДИЕНТЫ (через запятую)</label>
            <input className="adm-form-input" type="text" value={ingredients} onChange={e => setIngredients(e.target.value)} placeholder="Джин, лайм, сахарный сироп" />
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">ВКУСОВОЙ ПРОФИЛЬ</label>
            <input className="adm-form-input" type="text" value={taste} onChange={e => setTaste(e.target.value)} placeholder="Цитрусовый, освежающий" />
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">ИСТОРИЯ / ЛЕГЕНДА</label>
            <textarea className="adm-form-input adm-form-textarea" rows={3} value={story} onChange={e => setStory(e.target.value)} placeholder="2-3 предложения истории напитка..." />
          </div>
          <div className="adm-form-row">
            <div className="adm-form-field">
              <label className="adm-form-lbl">ЦЕНА</label>
              <input className="adm-form-input" type="text" value={price} onChange={e => setPrice(e.target.value)} placeholder="900 ₽" />
            </div>
            <div className="adm-form-field">
              <label className="adm-form-lbl">ССЫЛКА НА ФОТО</label>
              <input className="adm-form-input" type="text" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://... (необязательно)" />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(242,237,228,0.6)', cursor: 'pointer' }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            Показывать на сайте
          </label>
          {err && <div className="adm-error">{err}</div>}
          <button className="adm-btn adm-btn--primary" type="submit" disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </form>
      </div>
    </div>
  );
}

function TabMenu() {
  const [tick,      setTick]      = useState(0);
  const [cocktails, setCocktails] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [confirm,   setConfirm]   = useState(null);

  useEffect(() => {
    CocktailsService.getAllAdmin().then(setCocktails).catch(() => {});
  }, [tick]);

  async function handleSave(data) {
    if (editing) await CocktailsService.update(editing.id, data);
    else await CocktailsService.create(data);
    setShowModal(false);
    setEditing(null);
    setTick(n => n + 1);
  }

  async function handleMove(id, direction) {
    await CocktailsService.move(id, direction);
    setTick(n => n + 1);
  }

  function handleDelete(c) {
    setConfirm({
      title: 'Удалить коктейль',
      message: `Удалить «${c.name}» из меню без возможности восстановления?`,
      confirmLabel: 'Удалить',
      onConfirm: async () => {
        await CocktailsService.remove(c.id);
        setConfirm(null);
        setTick(n => n + 1);
      },
    });
  }

  return (
    <div className="adm-tab">
      <p className="adm-tab__desc">
        Управляйте карточками коктейлей на главной странице. Порядок — как в карусели на сайте.
      </p>
      <div className="adm-filters">
        <div style={{ flex: 1 }} />
        <button className="adm-btn adm-btn--primary" onClick={() => { setEditing(null); setShowModal(true); }}>
          + Добавить коктейль
        </button>
      </div>

      {cocktails.length === 0 ? (
        <div className="adm-empty">Меню пока пусто</div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Порядок</th><th>Название</th><th>Категория</th><th>Цена</th><th>Показ</th><th></th>
              </tr>
            </thead>
            <tbody>
              {cocktails.map((c, i) => (
                <tr key={c.id} className={!c.active ? 'adm-table__row--muted' : ''}>
                  <td>
                    <div className="adm-actions">
                      <button className="adm-act-btn adm-act-btn--move" style={{ opacity: i === 0 ? 0.3 : 1 }} disabled={i === 0} onClick={() => handleMove(c.id, 'up')} title="Выше">↑</button>
                      <button className="adm-act-btn adm-act-btn--move" style={{ opacity: i === cocktails.length - 1 ? 0.3 : 1 }} disabled={i === cocktails.length - 1} onClick={() => handleMove(c.id, 'down')} title="Ниже">↓</button>
                    </div>
                  </td>
                  <td className="adm-table__name">{c.name}</td>
                  <td>{c.category === 'signature' ? 'Авторский' : 'Классика'}</td>
                  <td>{c.price || '—'}</td>
                  <td>{c.active ? '✓ На сайте' : '— Скрыт'}</td>
                  <td>
                    <div className="adm-actions">
                      <button className="adm-act-btn adm-act-btn--ok" onClick={() => { setEditing(c); setShowModal(true); }} title="Редактировать">✎</button>
                      <button className="adm-act-btn adm-act-btn--del" onClick={() => handleDelete(c)} title="Удалить">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <CocktailModal
          initial={editing}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditing(null); }}
        />
      )}
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// ─── Tab: СОБЫТИЯ ─────────────────────────────────────────────────
function EventModal({ initial, onSave, onClose }) {
  const [title,       setTitle]       = useState(initial?.title || '');
  const [date,        setDate]        = useState(initial?.date || todayIso());
  const [time,        setTime]        = useState(initial?.time || '19:00');
  const [description, setDescription] = useState(initial?.description || '');
  const [imageUrl,    setImageUrl]    = useState(initial?.imageUrl || '');
  const [active,      setActive]      = useState(initial?.active !== false);
  const [err,         setErr]         = useState('');
  const [saving,      setSaving]      = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      await onSave({ title, date, time, description, imageUrl, active });
    } catch (ex) {
      setErr(ex.message);
      setSaving(false);
    }
  }

  return (
    <div className="adm-modal-overlay" onClick={onClose}>
      <div className="adm-modal" onClick={e => e.stopPropagation()}>
        <div className="adm-modal__head">
          <span className="adm-modal__title">{initial ? 'Редактировать событие' : 'Новое событие'}</span>
          <button className="adm-modal__close" onClick={onClose}>✕</button>
        </div>
        <form className="adm-modal__form" onSubmit={handleSubmit}>
          <div className="adm-form-field">
            <label className="adm-form-lbl">НАЗВАНИЕ *</label>
            <input className="adm-form-input" type="text" required value={title} onChange={e => setTitle(e.target.value)} placeholder="Живая музыка" />
          </div>
          <div className="adm-form-row">
            <div className="adm-form-field">
              <label className="adm-form-lbl">ДАТА *</label>
              <input className="adm-form-input" type="date" required value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="adm-form-field">
              <label className="adm-form-lbl">ВРЕМЯ</label>
              <input className="adm-form-input" type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">ОПИСАНИЕ</label>
            <textarea className="adm-form-input adm-form-textarea" rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Ансамбль Дмитрия Дмитриева — джаз прямо на сцене бара" />
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">ССЫЛКА НА ФОТО</label>
            <input className="adm-form-input" type="text" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://... (станет фоном карточки)" />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(242,237,228,0.6)', cursor: 'pointer' }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            Показывать на сайте
          </label>
          {err && <div className="adm-error">{err}</div>}
          <button className="adm-btn adm-btn--primary" type="submit" disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </form>
      </div>
    </div>
  );
}

function TabEvents() {
  const [tick,      setTick]      = useState(0);
  const [events,    setEvents]    = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [confirm,   setConfirm]   = useState(null);

  useEffect(() => {
    EventsService.getAllAdmin().then(setEvents).catch(() => {});
  }, [tick]);

  async function handleSave(data) {
    if (editing) await EventsService.update(editing.id, data);
    else await EventsService.create(data);
    setShowModal(false);
    setEditing(null);
    setTick(n => n + 1);
  }

  function handleDelete(ev) {
    setConfirm({
      title: 'Удалить событие',
      message: `Удалить «${ev.title}» без возможности восстановления?`,
      confirmLabel: 'Удалить',
      onConfirm: async () => {
        await EventsService.remove(ev.id);
        setConfirm(null);
        setTick(n => n + 1);
      },
    });
  }

  // "Повторить" clones the event one week later — a cheap way to keep
  // recurring weekly programming (e.g. "every Saturday") without building
  // a full recurrence engine.
  async function handleDuplicate(ev) {
    const nextDate = new Date(ev.date + 'T00:00:00');
    nextDate.setDate(nextDate.getDate() + 7);
    await EventsService.create({
      title: ev.title, date: nextDate.toISOString().split('T')[0],
      time: ev.time, description: ev.description, imageUrl: ev.imageUrl, active: true,
    });
    setTick(n => n + 1);
  }

  const today = todayIso();

  return (
    <div className="adm-tab">
      <p className="adm-tab__desc">
        Прошедшие события автоматически скрываются с сайта, но остаются здесь. «⟳» клонирует событие на ту же дату через неделю — удобно для регулярной программы.
      </p>
      <div className="adm-filters">
        <div style={{ flex: 1 }} />
        <button className="adm-btn adm-btn--primary" onClick={() => { setEditing(null); setShowModal(true); }}>
          + Добавить событие
        </button>
      </div>

      {events.length === 0 ? (
        <div className="adm-empty">Событий пока нет</div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Дата</th><th>Время</th><th>Название</th><th>Показ</th><th></th>
              </tr>
            </thead>
            <tbody>
              {events.map(ev => {
                const isPast = ev.date < today;
                return (
                  <tr key={ev.id} className={(isPast || !ev.active) ? 'adm-table__row--muted' : ''}>
                    <td>
                      {formatDate(ev.date)}
                      {isPast && <span style={{ marginLeft: 6, fontSize: 10, opacity: .6 }}>прошло</span>}
                    </td>
                    <td className="adm-table__time">{ev.time || '—'}</td>
                    <td className="adm-table__name">{ev.title}</td>
                    <td>{ev.active ? '✓ На сайте' : '— Скрыто'}</td>
                    <td>
                      <div className="adm-actions">
                        <button className="adm-act-btn adm-act-btn--move" onClick={() => handleDuplicate(ev)} title="Повторить через неделю">⟳</button>
                        <button className="adm-act-btn adm-act-btn--ok" onClick={() => { setEditing(ev); setShowModal(true); }} title="Редактировать">✎</button>
                        <button className="adm-act-btn adm-act-btn--del" onClick={() => handleDelete(ev)} title="Удалить">✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <EventModal
          initial={editing}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditing(null); }}
        />
      )}
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// ─── Tab: ОТЗЫВЫ ──────────────────────────────────────────────────
function ReviewModal({ initial, onSave, onClose }) {
  const [author, setAuthor] = useState(initial?.author || '');
  const [rating, setRating] = useState(initial?.rating || 5);
  const [text,   setText]   = useState(initial?.text || '');
  const [date,   setDate]   = useState(initial?.date || todayIso());
  const [active, setActive] = useState(initial?.active !== false);
  const [err,    setErr]    = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      await onSave({ author, rating: parseInt(rating), text, date, active });
    } catch (ex) {
      setErr(ex.message);
      setSaving(false);
    }
  }

  return (
    <div className="adm-modal-overlay" onClick={onClose}>
      <div className="adm-modal" onClick={e => e.stopPropagation()}>
        <div className="adm-modal__head">
          <span className="adm-modal__title">{initial ? 'Редактировать отзыв' : 'Новый отзыв'}</span>
          <button className="adm-modal__close" onClick={onClose}>✕</button>
        </div>
        <form className="adm-modal__form" onSubmit={handleSubmit}>
          <div className="adm-form-row">
            <div className="adm-form-field">
              <label className="adm-form-lbl">АВТОР *</label>
              <input className="adm-form-input" type="text" required value={author} onChange={e => setAuthor(e.target.value)} placeholder="Екатерина Х." />
            </div>
            <div className="adm-form-field">
              <label className="adm-form-lbl">ОЦЕНКА</label>
              <select className="adm-form-input" value={rating} onChange={e => setRating(e.target.value)}>
                {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n} {'★'.repeat(n)}</option>)}
              </select>
            </div>
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">ДАТА ОТЗЫВА</label>
            <input className="adm-form-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">ТЕКСТ ОТЗЫВА</label>
            <textarea className="adm-form-input adm-form-textarea" rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="Скопируйте текст отзыва (например, с Яндекс.Карт)..." />
          </div>
          {rating < 4 && (
            <div className="adm-error" style={{ background: 'rgba(212,168,67,0.08)', borderColor: 'rgba(212,168,67,0.25)', color: '#D4A843' }}>
              Отзывы с оценкой ниже 4★ никогда не показываются на сайте — это просто заметка для внутреннего учёта.
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(242,237,228,0.6)', cursor: 'pointer' }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            Показывать на сайте (если оценка ≥ 4★)
          </label>
          {err && <div className="adm-error">{err}</div>}
          <button className="adm-btn adm-btn--primary" type="submit" disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </form>
      </div>
    </div>
  );
}

function TabReviews() {
  const [tick,      setTick]      = useState(0);
  const [reviews,   setReviews]   = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [confirm,   setConfirm]   = useState(null);

  useEffect(() => {
    ReviewsService.getAllAdmin().then(setReviews).catch(() => {});
  }, [tick]);

  async function handleSave(data) {
    if (editing) await ReviewsService.update(editing.id, data);
    else await ReviewsService.create(data);
    setShowModal(false);
    setEditing(null);
    setTick(n => n + 1);
  }

  function handleDelete(rv) {
    setConfirm({
      title: 'Удалить отзыв',
      message: `Удалить отзыв «${rv.author}» без возможности восстановления?`,
      confirmLabel: 'Удалить',
      onConfirm: async () => {
        await ReviewsService.remove(rv.id);
        setConfirm(null);
        setTick(n => n + 1);
      },
    });
  }

  return (
    <div className="adm-tab">
      <p className="adm-tab__desc">
        Публично показываются только отзывы с оценкой от 4★ и включённым показом. Отзывы 1-3★ можно сохранить для внутреннего учёта — на сайт они не попадут.
      </p>
      <div className="adm-filters">
        <div style={{ flex: 1 }} />
        <button className="adm-btn adm-btn--primary" onClick={() => { setEditing(null); setShowModal(true); }}>
          + Добавить отзыв
        </button>
      </div>

      {reviews.length === 0 ? (
        <div className="adm-empty">Отзывов пока нет</div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Дата</th><th>Автор</th><th>Оценка</th><th>Публично</th><th></th>
              </tr>
            </thead>
            <tbody>
              {reviews.map(rv => {
                const isPublic = rv.active && rv.rating >= 4;
                return (
                  <tr key={rv.id} className={!isPublic ? 'adm-table__row--muted' : ''}>
                    <td>{formatDate(rv.date)}</td>
                    <td className="adm-table__name">{rv.author}</td>
                    <td style={{ color: '#D4A843' }}>{'★'.repeat(rv.rating)}{'☆'.repeat(5 - rv.rating)}</td>
                    <td>{isPublic ? '✓ На сайте' : '— Скрыт'}</td>
                    <td>
                      <div className="adm-actions">
                        <button className="adm-act-btn adm-act-btn--ok" onClick={() => { setEditing(rv); setShowModal(true); }} title="Редактировать">✎</button>
                        <button className="adm-act-btn adm-act-btn--del" onClick={() => handleDelete(rv)} title="Удалить">✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <ReviewModal
          initial={editing}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditing(null); }}
        />
      )}
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// ─── Tab: КОМАНДА ─────────────────────────────────────────────────
function TeamModal({ initial, onSave, onClose }) {
  const [name,        setName]        = useState(initial?.name || '');
  const [role,        setRole]        = useState(initial?.role || '');
  const [spec,        setSpec]        = useState(initial?.spec || '');
  const [bio,         setBio]         = useState(initial?.bio || '');
  const [quote,       setQuote]       = useState(initial?.quote || '');
  const [quoteSource, setQuoteSource] = useState(initial?.quoteSource || '');
  const [photoUrl,    setPhotoUrl]    = useState(initial?.photoUrl || '');
  const [active,      setActive]      = useState(initial?.active !== false);
  const [err,         setErr]         = useState('');
  const [saving,      setSaving]      = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      await onSave({ name, role, spec, bio, quote, quoteSource, photoUrl, active });
    } catch (ex) {
      setErr(ex.message);
      setSaving(false);
    }
  }

  return (
    <div className="adm-modal-overlay" onClick={onClose}>
      <div className="adm-modal" onClick={e => e.stopPropagation()}>
        <div className="adm-modal__head">
          <span className="adm-modal__title">{initial ? 'Редактировать участника' : 'Новый участник команды'}</span>
          <button className="adm-modal__close" onClick={onClose}>✕</button>
        </div>
        <form className="adm-modal__form" onSubmit={handleSubmit}>
          <div className="adm-form-row">
            <div className="adm-form-field">
              <label className="adm-form-lbl">ИМЯ *</label>
              <input className="adm-form-input" type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="Шамусар" />
            </div>
            <div className="adm-form-field">
              <label className="adm-form-lbl">РОЛЬ</label>
              <input className="adm-form-input" type="text" value={role} onChange={e => setRole(e.target.value)} placeholder="Старший бартендер" />
            </div>
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">КОРОТКОЕ ОПИСАНИЕ</label>
            <input className="adm-form-input" type="text" value={spec} onChange={e => setSpec(e.target.value)} placeholder="Более 20 лет за стойкой" />
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">БИОГРАФИЯ (показывается на сайте, можно пусто)</label>
            <textarea className="adm-form-input adm-form-textarea" rows={3} value={bio} onChange={e => setBio(e.target.value)} placeholder="Как попал в профессию, чем известен…" />
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">ЦИТАТА ИЗ КНИГИ (о баре/алкоголе)</label>
            <textarea className="adm-form-input adm-form-textarea" rows={2} value={quote} onChange={e => setQuote(e.target.value)} placeholder="Пейте быстро, пока коктейль смеётся над вами!" />
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">ИСТОЧНИК ЦИТАТЫ (автор, книга)</label>
            <input className="adm-form-input" type="text" value={quoteSource} onChange={e => setQuoteSource(e.target.value)} placeholder="Гарри Крэддок, «The Savoy Cocktail Book»" />
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">ССЫЛКА НА ФОТО</label>
            <input className="adm-form-input" type="text" value={photoUrl} onChange={e => setPhotoUrl(e.target.value)} placeholder="https://..." />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(242,237,228,0.6)', cursor: 'pointer' }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            Показывать на сайте
          </label>
          {err && <div className="adm-error">{err}</div>}
          <button className="adm-btn adm-btn--primary" type="submit" disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </form>
      </div>
    </div>
  );
}

function TabTeam() {
  const [tick,        setTick]        = useState(0);
  const [members,     setMembers]     = useState([]);
  const [applications, setApplications] = useState([]);
  const [showModal,   setShowModal]   = useState(false);
  const [editing,     setEditing]     = useState(null);
  const [confirm,      setConfirm]     = useState(null);

  useEffect(() => {
    TeamService.getAllAdmin().then(setMembers).catch(() => {});
    ApplicationsService.getAllAdmin().then(setApplications).catch(() => {});
  }, [tick]);

  async function handleSave(data) {
    if (editing) await TeamService.update(editing.id, data);
    else await TeamService.create(data);
    setShowModal(false);
    setEditing(null);
    setTick(n => n + 1);
  }

  async function handleMove(id, direction) {
    await TeamService.move(id, direction);
    setTick(n => n + 1);
  }

  function handleDelete(m) {
    setConfirm({
      title: 'Удалить участника',
      message: `Удалить «${m.name}» из команды без возможности восстановления?`,
      confirmLabel: 'Удалить',
      onConfirm: async () => {
        await TeamService.remove(m.id);
        setConfirm(null);
        setTick(n => n + 1);
      },
    });
  }

  async function handleMarkReviewed(id) {
    await ApplicationsService.markReviewed(id);
    setTick(n => n + 1);
  }

  function handleDeleteApplication(ap) {
    setConfirm({
      title: 'Удалить заявку',
      message: `Удалить заявку от «${ap.name}» без возможности восстановления?`,
      confirmLabel: 'Удалить',
      onConfirm: async () => {
        await ApplicationsService.remove(ap.id);
        setConfirm(null);
        setTick(n => n + 1);
      },
    });
  }

  return (
    <div className="adm-tab">
      <p className="adm-tab__desc">
        Состав команды на главной странице (карусель) — порядок можно менять стрелками.
      </p>
      <div className="adm-filters">
        <div style={{ flex: 1 }} />
        <button className="adm-btn adm-btn--primary" onClick={() => { setEditing(null); setShowModal(true); }}>
          + Добавить участника
        </button>
      </div>

      {members.length === 0 ? (
        <div className="adm-empty">Команда пока пуста</div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Порядок</th><th>Имя</th><th>Роль</th><th>Показ</th><th></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={m.id} className={!m.active ? 'adm-table__row--muted' : ''}>
                  <td>
                    <div className="adm-actions">
                      <button className="adm-act-btn adm-act-btn--move" style={{ opacity: i === 0 ? 0.3 : 1 }} disabled={i === 0} onClick={() => handleMove(m.id, 'up')} title="Выше">↑</button>
                      <button className="adm-act-btn adm-act-btn--move" style={{ opacity: i === members.length - 1 ? 0.3 : 1 }} disabled={i === members.length - 1} onClick={() => handleMove(m.id, 'down')} title="Ниже">↓</button>
                    </div>
                  </td>
                  <td className="adm-table__name">{m.name}</td>
                  <td>{m.role || '—'}</td>
                  <td>{m.active ? '✓ На сайте' : '— Скрыт'}</td>
                  <td>
                    <div className="adm-actions">
                      <button className="adm-act-btn adm-act-btn--ok" onClick={() => { setEditing(m); setShowModal(true); }} title="Редактировать">✎</button>
                      <button className="adm-act-btn adm-act-btn--del" onClick={() => handleDelete(m)} title="Удалить">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="adm-tab__desc" style={{ marginTop: 32 }}>
        Заявки «Стать барменом» — сохраняются здесь и дублируются в Telegram администраторам.
      </p>
      {applications.length === 0 ? (
        <div className="adm-empty">Заявок пока нет</div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Дата</th><th>Имя</th><th>Телефон</th><th>Опыт</th><th>Статус</th><th></th>
              </tr>
            </thead>
            <tbody>
              {applications.map(ap => (
                <tr key={ap.id} className={ap.status === 'reviewed' ? 'adm-table__row--muted' : ''}>
                  <td>{formatDate(ap.createdAt.split('T')[0])}</td>
                  <td className="adm-table__name">{ap.name}</td>
                  <td className="adm-table__phone">{ap.phone}</td>
                  <td style={{ maxWidth: 260 }}>{ap.experience || '—'}</td>
                  <td>{ap.status === 'reviewed' ? '✓ Просмотрено' : '🆕 Новая'}</td>
                  <td>
                    <div className="adm-actions">
                      {ap.status !== 'reviewed' && (
                        <button className="adm-act-btn adm-act-btn--ok" onClick={() => handleMarkReviewed(ap.id)} title="Отметить просмотренной">✓</button>
                      )}
                      <button className="adm-act-btn adm-act-btn--del" onClick={() => handleDeleteApplication(ap)} title="Удалить">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <TeamModal
          initial={editing}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditing(null); }}
        />
      )}
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// ─── Tab: ГОСТИ ──────────────────────────────────────────────────
// Уровни (см. api/_lib/loyalty.js): считаются автоматически из числа
// подтверждённых броней, здесь их можно выставить вручную (override).
const LEVEL_OPTIONS = [
  [1, '🍾 1 — Шампанское'],
  [2, '🍷 2 — Вино'],
  [3, '🫒 3 — Вермут'],
  [4, '🍸 4 — Джин'],
  [5, '🍹 5 — Ром'],
  [6, '🌵 6 — Текила'],
  [7, '🥃 7 — Виски'],
  [8, '👑 8 — Коньяк'],
  [9, '🧚 9 — Абсент'],
];

function fmtRegDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function GuestHistoryModal({ guest, onClose }) {
  const [items, setItems] = useState(null); // null = загружаем
  const [error, setError] = useState(false);

  useEffect(() => {
    GuestsService.history(guest.id)
      .then(setItems)
      .catch(() => setError(true));
  }, [guest.id]);

  return (
    <div className="adm-modal-overlay" onClick={onClose}>
      <div className="adm-modal adm-modal--wide" onClick={e => e.stopPropagation()}>
        <div className="adm-modal__head">
          <span className="adm-modal__title">Брони — {guest.name || 'Без имени'}</span>
          <button className="adm-modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="adm-modal__form">
          {error ? (
            <div className="adm-empty">Не удалось загрузить историю — попробуйте ещё раз</div>
          ) : items === null ? (
            <div className="adm-empty">Загружаем…</div>
          ) : items.length === 0 ? (
            <div className="adm-empty">Броней ещё не было</div>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr><th>Дата</th><th>Время</th><th>Стол</th><th>Гостей</th><th>Источник</th><th>Статус</th></tr>
                </thead>
                <tbody>
                  {items.map(r => {
                    const st = STATUS_LABELS[r.status] || { text: r.status, color: '#888' };
                    const src = SOURCE_LABELS[r.source] || { text: r.source, color: '#888' };
                    return (
                      <tr key={r.id}>
                        <td className="adm-table__time">{fmtRegDate(r.date)}</td>
                        <td className="adm-table__time">{r.timeFrom}</td>
                        <td className="adm-table__table-id">{r.tableId}</td>
                        <td>{r.guestsCount}</td>
                        <td><span className="adm-badge" style={{ color: src.color, background: src.color + '18', borderColor: src.color + '44' }}>{src.text}</span></td>
                        <td><span className="adm-badge" style={{ color: st.color, background: st.color + '18', borderColor: st.color + '44' }}>{st.text}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabGuests() {
  const { toast } = useFeedback();
  const [guests,     setGuests]     = useState([]);
  const [loaded,     setLoaded]     = useState(false);
  const [search,     setSearch]     = useState('');
  const [sort,       setSort]       = useState('level'); // level | name | date
  const [historyFor, setHistoryFor] = useState(null);
  const [savingId,   setSavingId]   = useState(null);

  function load() {
    GuestsService.list()
      .then(g => { setGuests(g); setLoaded(true); })
      .catch(() => { setGuests([]); setLoaded(true); });
  }
  useEffect(load, []);

  async function handleLevelChange(g, value) {
    const level = value === '' ? null : parseInt(value);
    setSavingId(g.id);
    try {
      await GuestsService.setLevel(g.id, level);
      toast.success(level ? 'Уровень обновлён' : 'Уровень снова считается автоматически');
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSavingId(null);
    }
  }

  const q = search.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  const filtered = guests.filter(g => {
    if (!q) return true;
    const byName = (g.name || '').toLowerCase().includes(q)
      || (g.telegramUsername || '').toLowerCase().includes(q.replace(/^@/, ''));
    const byPhone = qDigits.length >= 3 && (g.phone || '').includes(qDigits);
    return byName || byPhone;
  });
  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'name') return (a.name || 'яя').localeCompare(b.name || 'яя', 'ru');
    if (sort === 'date') return a.createdAt < b.createdAt ? 1 : -1;
    // по уровню: высокие сверху, при равенстве — у кого больше броней
    return (b.level.num - a.level.num) || (b.bookings - a.bookings);
  });

  return (
    <div className="adm-tab">
      <p className="adm-tab__desc">
        Все зарегистрированные гости — с сайта и из Telegram. Уровень растёт сам с каждой подтверждённой бронью; чтобы поднять вручную — выберите уровень в списке, «авто» вернёт автоматический расчёт.
      </p>
      <div className="adm-filters">
        <input
          className="adm-select"
          style={{ width: 250 }}
          type="text"
          placeholder="Поиск: имя, @username или телефон"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="adm-select" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="level">Сначала высокий уровень</option>
          <option value="name">По имени</option>
          <option value="date">Сначала новые</option>
        </select>
        <div style={{ flex: 1 }} />
        <span className="adm-guests-count">{sorted.length} из {guests.length}</span>
      </div>

      {!loaded ? (
        <div className="adm-empty">Загружаем…</div>
      ) : sorted.length === 0 ? (
        <div className="adm-empty">{q ? 'Никого не нашли — проверьте запрос' : 'Гостей пока нет'}</div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>Гость</th><th>Телефон</th><th>Telegram</th><th>Уровень</th><th>Брони</th><th>Регистрация</th><th>История</th></tr>
            </thead>
            <tbody>
              {sorted.map(g => (
                <tr key={g.id}>
                  <td className="adm-table__name">
                    {g.name || 'Без имени'}
                    {g.role === 'admin' && (
                      <span className="adm-badge" style={{ marginLeft: 8, color: '#D4A843', background: '#D4A84318', borderColor: '#D4A84344' }}>админ</span>
                    )}
                  </td>
                  <td className="adm-table__phone">{g.phone ? `+${g.phone}` : '—'}</td>
                  <td className="adm-table__phone">
                    {g.telegramUsername ? `@${g.telegramUsername}` : g.telegramId ? `id ${g.telegramId}` : '—'}
                  </td>
                  <td>
                    <div className="adm-guest-level">
                      <span className="adm-badge adm-guest-level__badge" title={g.levelOverride ? 'Выставлен вручную' : 'Считается автоматически'}>
                        {g.level.emoji} {g.level.num} · {g.level.label}{g.levelOverride ? ' ✎' : ''}
                      </span>
                      <select
                        className="adm-select adm-select--sm"
                        value={g.levelOverride || ''}
                        onChange={e => handleLevelChange(g, e.target.value)}
                        disabled={savingId === g.id}
                        title="Выставить уровень вручную"
                      >
                        <option value="">авто</option>
                        {LEVEL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                  </td>
                  <td>{g.bookings}</td>
                  <td className="adm-table__time">{fmtRegDate(g.createdAt)}</td>
                  <td>
                    <div className="adm-actions">
                      <button className="adm-act-btn adm-act-btn--move" onClick={() => setHistoryFor(g)} title="История броней">🕐</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {historyFor && <GuestHistoryModal guest={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

// ─── Tab: СТОЛЫ ──────────────────────────────────────────────────
// Тот же план зала, что видят гости в брони (переделано 2026-07-04 по просьбе
// владельца): клик по столу открывает справа настройки именно этого стола —
// депозит и число мест числовыми полями. Позиции столов статичны
// (src/booking/tablesConfig.js), drag&drop-редактора нет.
// Ниже — календарь дат: какие дни закрыты для брони.

function TableEditorPanel({ table, onSaved }) {
  const { toast } = useFeedback();
  const [price, setPrice] = useState(table.depositPrice ?? 0);
  const [seats, setSeats] = useState(table.activeSeatsCount ?? 4);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPrice(table.depositPrice ?? 0);
    setSeats(table.activeSeatsCount ?? 4);
  }, [table.id, table.depositPrice, table.activeSeatsCount]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await BookingService.setTableDepositPrice(table.id, parseInt(price, 10) || 0);
      await BookingService.setTableSeatsCount(table.id, parseInt(seats, 10) || 1);
      toast.success('Настройки стола сохранены');
      onSaved();
    } catch (ex) {
      toast.error(ex.message);
    } finally {
      setSaving(false);
    }
  }

  const title = table.type === 'booth' ? `Диван №${table.num}` : `${table.zone}, стол №${table.num}`;

  return (
    <form className="adm-tblcfg__panel" onSubmit={handleSave}>
      <div className="adm-tblcfg__title">{title}</div>
      <div className="adm-form-field">
        <label className="adm-form-lbl">ДЕПОЗИТ, ₽ (0 — БЕЗ ДЕПОЗИТА)</label>
        <input className="adm-form-input" type="number" min="0" step="100"
          value={price} onChange={e => setPrice(e.target.value)} />
      </div>
      <div className="adm-form-field">
        <label className="adm-form-lbl">ДОСТУПНО МЕСТ</label>
        <input className="adm-form-input" type="number" min="1" max="30"
          value={seats} onChange={e => setSeats(e.target.value)} />
      </div>
      <button className="adm-btn adm-btn--primary" type="submit" disabled={saving}>
        {saving ? 'Сохраняем…' : 'Сохранить'}
      </button>
    </form>
  );
}

// Календарь дат: закрытые даты + переключатели кнопок «Сегодня»/«Завтра».
// Флаг «Сегодня» привязан к КНОПКЕ, а не к дате: пока включён, каждый новый
// день блокирует свою «сегодняшнюю» дату (просьба владельца).
function BookingDatesSection() {
  const { toast } = useFeedback();
  const [cfg, setCfg] = useState(null);
  const [newDate, setNewDate] = useState('');

  useEffect(() => { BookingService.getBookingDates().then(setCfg).catch(() => {}); }, []);

  async function apply(patch, okText) {
    try {
      const next = await BookingService.setBookingDates(patch);
      setCfg(next);
      if (okText) toast.success(okText);
    } catch (e) {
      toast.error(e.message);
    }
  }

  if (!cfg) return null;

  const days = upcomingEveningDates(14);
  const fmt = (iso) => { const [, m, d] = iso.split('-'); return `${d}.${m}`; };
  const extraBlocked = cfg.blockedDates.filter(d => !days.includes(d));

  return (
    <>
      <p className="adm-tab__desc" style={{ marginTop: 32 }}>
        Даты брони: нажмите на дату, чтобы закрыть или открыть её. Переключатели «Сегодня»/«Завтра» блокируют сами кнопки на сайте и переезжают на новый день автоматически — закрытое «сегодня» и завтра останется закрытым.
      </p>
      <div className="adm-filters">
        <button type="button"
          className={`adm-btn ${cfg.blockToday ? 'adm-btn--primary' : 'adm-btn--ghost'}`}
          onClick={() => apply({ blockToday: !cfg.blockToday }, cfg.blockToday ? 'Кнопка «Сегодня» открыта' : 'Кнопка «Сегодня» закрыта')}>
          {cfg.blockToday ? '🚫 «Сегодня» закрыто' : '✅ «Сегодня» открыто'}
        </button>
        <button type="button"
          className={`adm-btn ${cfg.blockTomorrow ? 'adm-btn--primary' : 'adm-btn--ghost'}`}
          onClick={() => apply({ blockTomorrow: !cfg.blockTomorrow }, cfg.blockTomorrow ? 'Кнопка «Завтра» открыта' : 'Кнопка «Завтра» закрыта')}>
          {cfg.blockTomorrow ? '🚫 «Завтра» закрыто' : '✅ «Завтра» открыто'}
        </button>
      </div>
      <div className="adm-dates-grid">
        {days.map(d => {
          const blocked = cfg.blockedDates.includes(d);
          return (
            <button key={d} type="button"
              className={`adm-date-chip${blocked ? ' adm-date-chip--blocked' : ''}`}
              title={blocked ? 'Открыть дату для брони' : 'Закрыть дату для брони'}
              onClick={() => apply(blocked ? { removeDate: d } : { addDate: d })}>
              {blocked ? '🚫' : '✅'} {fmt(d)}
            </button>
          );
        })}
        {extraBlocked.map(d => (
          <button key={d} type="button" className="adm-date-chip adm-date-chip--blocked"
            title="Открыть дату для брони"
            onClick={() => apply({ removeDate: d })}>
            🚫 {fmt(d)}.{d.slice(0, 4)}
          </button>
        ))}
      </div>
      <div className="adm-filters" style={{ marginTop: 10 }}>
        <input className="adm-select" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
        <button type="button" className="adm-btn adm-btn--ghost" disabled={!newDate}
          onClick={() => { apply({ addDate: newDate }, 'Дата закрыта для брони'); setNewDate(''); }}>
          Закрыть выбранную дату
        </button>
      </div>
    </>
  );
}

function TabTables() {
  const [tables, setTables] = useState([]);
  const [selId, setSelId] = useState(null);

  function load() {
    // Публичный статус-эндпоинт: те же цвета/статусы, что видят гости,
    // плюс depositPrice/activeSeatsCount из merged-конфига.
    BookingService.getTablesWithStatus().then(setTables).catch(() => setTables([]));
  }
  useEffect(load, []);

  const sel = selId ? tables.find(t => t.id === selId) : null;

  return (
    <div className="adm-tab">
      <p className="adm-tab__desc">
        Нажмите на стол на плане — справа откроются его настройки: депозит и число доступных мест.
      </p>
      <div className="adm-tblcfg">
        <div className="adm-tblcfg__plan bkw">
          <FloorPlanSvg
            tables={tables}
            selectedTableId={selId}
            onSelect={setSelId}
            onDeselect={() => setSelId(null)}
          />
        </div>
        {sel ? (
          <TableEditorPanel table={sel} onSaved={load} />
        ) : (
          <div className="adm-tblcfg__hint">Выберите стол на плане слева</div>
        )}
      </div>

      <BookingDatesSection />
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel, onConfirm, onClose }) {
  return (
    <div className="adm-modal-overlay" onClick={onClose}>
      <div className="adm-modal adm-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="adm-modal__head">
          <span className="adm-modal__title">{title}</span>
          <button className="adm-modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="adm-confirm">
          <p className="adm-confirm__msg">{message}</p>
          <div className="adm-confirm__actions">
            <button className="adm-btn adm-btn--ghost" onClick={onClose}>Отмена</button>
            <button className="adm-btn adm-btn--primary" onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────
export default function AdminPage() {
  usePageMeta({ title: "Админ-панель — The Cat's Pajamas Club", noindex: true });
  const navigate  = useNavigate();
  const [user,    setUser]    = useState(null);
  const [tab,     setTab]     = useState('reservations');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const u = AuthService.getCurrentUser();
    if (!u) { navigate('/auth?next=/admin', { replace: true }); return; }
    setUser(u);
    setChecked(true);
  }, []);

  function handleLogout() {
    AuthService.logout();
    navigate('/', { replace: true });
  }

  if (!checked) return null;

  if (!user || user.role !== 'admin') {
    return (
      <div className="adm-root">
        <div className="adm-denied">
          <div className="adm-denied__icon">⊘</div>
          <div className="adm-denied__title">Нет доступа</div>
          <div className="adm-denied__text">Эта страница доступна только администраторам заведения.</div>
          <Link to="/booking" className="adm-btn adm-btn--primary" style={{ textDecoration: 'none', marginTop: 16, display: 'inline-block' }}>
            ← К плану зала
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="adm-root">
      <header className="adm-header">
        <Link to="/booking" className="adm-header__logo">
          <img src="/uploads/logo-icon.svg" alt="The Cat's Pajamas Club" style={{ height: 24, width: 'auto', display: 'block' }} />
          <span className="adm-header__logo-text">CAT'S PAJAMAS</span>
        </Link>
        <div className="adm-header__divider" />
        <span className="adm-header__title">КАБИНЕТ АДМИНИСТРАТОРА</span>
        <div style={{ flex: 1 }} />
        <Link to="/booking" className="adm-header__link">← К плану зала</Link>
        <button className="adm-header__logout" onClick={handleLogout}>Выйти</button>
      </header>

      <div className="adm-tabs">
        {[['reservations','БРОНИ'],['tables','СТОЛЫ'],['menu','МЕНЮ'],['events','СОБЫТИЯ'],['reviews','ОТЗЫВЫ'],['team','КОМАНДА'],['guests','ГОСТИ']].map(([key, label]) => (
          <button key={key}
            className={`adm-tab-btn${tab === key ? ' adm-tab-btn--active' : ''}`}
            onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      <main className="adm-main">
        {tab === 'reservations' && <TabReservations adminId={user.id} />}
        {tab === 'tables'       && <TabTables />}
        {tab === 'menu'         && <TabMenu />}
        {tab === 'events'       && <TabEvents />}
        {tab === 'reviews'      && <TabReviews />}
        {tab === 'team'         && <TabTeam />}
        {tab === 'guests'       && <TabGuests />}
      </main>
    </div>
  );
}
