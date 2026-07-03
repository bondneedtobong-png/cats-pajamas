import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthService from '../auth/AuthService.js';
import BookingService from '../booking/BookingService.js';
import { BAR_STOOL_W, BAR_STOOL_H } from '../booking/tablesConfig.js';
import CocktailsService from '../menu/CocktailsService.js';
import EventsService from '../events/EventsService.js';
import ReviewsService from '../reviews/ReviewsService.js';
import TeamService from '../team/TeamService.js';
import ApplicationsService from '../team/ApplicationsService.js';
import LoyaltyService from '../loyalty/LoyaltyService.js';
import { useFeedback } from '../ui/FeedbackProvider.jsx';
import './admin.css';

const SOURCE_LABELS = {
  web:           { text: 'Сайт',    color: '#9B5DE5' },
  phone_manual:  { text: 'Звонок',  color: '#D4A843' },
  telegram_bot:  { text: 'Telegram',color: '#0088cc' },
};
const STATUS_LABELS = {
  pending:   { text: 'Ожидает',   color: '#D4A843' },
  confirmed: { text: 'Активна',   color: '#22c55e' },
  cancelled: { text: 'Отменена',  color: '#6b7280' },
  completed: { text: 'Завершена', color: '#9B5DE5' },
  no_show:   { text: 'Неявка',    color: '#f87171' },
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
          <option value="confirmed">Активна</option>
          <option value="pending">Ожидает</option>
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
                const isActive = r.status === 'confirmed' || r.status === 'pending';
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
                          <>
                            <button className="adm-act-btn adm-act-btn--done" onClick={() => handleStatus(r.id, 'completed')} title="Завершить">●</button>
                            <button className="adm-act-btn adm-act-btn--no" onClick={() => handleStatus(r.id, 'no_show')} title="Неявка">✗</button>
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
  const [name,     setName]     = useState(initial?.name || '');
  const [role,     setRole]     = useState(initial?.role || '');
  const [spec,     setSpec]     = useState(initial?.spec || '');
  const [quote,    setQuote]    = useState(initial?.quote || '');
  const [photoUrl, setPhotoUrl] = useState(initial?.photoUrl || '');
  const [active,   setActive]   = useState(initial?.active !== false);
  const [err,      setErr]      = useState('');
  const [saving,   setSaving]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      await onSave({ name, role, spec, quote, photoUrl, active });
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
            <label className="adm-form-lbl">ЦИТАТА (в кавычках)</label>
            <textarea className="adm-form-input adm-form-textarea" rows={2} value={quote} onChange={e => setQuote(e.target.value)} placeholder="«Коктейль — это точная наука с душой импровизации»" />
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

// ─── Tab: ЛОЯЛЬНОСТЬ ──────────────────────────────────────────────
const TIER_OPTIONS = [
  ['',        'Любой'],
  ['kitten',  'Котёнок'],
  ['jazzcat', 'Кот джаза'],
  ['oldpaw',  'Мурлыка-старожил'],
  ['boss',    'Хозяин клуба'],
];
const TIER_LABEL_BY_KEY = Object.fromEntries(TIER_OPTIONS);

function RewardModal({ initial, onSave, onClose }) {
  const [title,            setTitle]            = useState(initial?.title || '');
  const [description,      setDescription]      = useState(initial?.description || '');
  const [costPoints,       setCostPoints]       = useState(initial?.costPoints ?? 50);
  const [tierRequired,     setTierRequired]     = useState(initial?.tierRequired || '');
  const [expiresAfterDays, setExpiresAfterDays] = useState(initial?.expiresAfterDays ?? '');
  const [active,           setActive]           = useState(initial?.active !== false);
  const [err,    setErr]    = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      await onSave({
        title, description,
        costPoints: parseInt(costPoints) || 0,
        tierRequired: tierRequired || null,
        expiresAfterDays: expiresAfterDays ? parseInt(expiresAfterDays) : null,
        active,
      });
    } catch (ex) {
      setErr(ex.message);
      setSaving(false);
    }
  }

  return (
    <div className="adm-modal-overlay" onClick={onClose}>
      <div className="adm-modal" onClick={e => e.stopPropagation()}>
        <div className="adm-modal__head">
          <span className="adm-modal__title">{initial ? 'Редактировать награду' : 'Новая награда'}</span>
          <button className="adm-modal__close" onClick={onClose}>✕</button>
        </div>
        <form className="adm-modal__form" onSubmit={handleSubmit}>
          <div className="adm-form-field">
            <label className="adm-form-lbl">НАЗВАНИЕ *</label>
            <input className="adm-form-input" type="text" required value={title} onChange={e => setTitle(e.target.value)} placeholder="Десерт в подарок" />
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">ОПИСАНИЕ</label>
            <textarea className="adm-form-input adm-form-textarea" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Один десерт на выбор из меню" />
          </div>
          <div className="adm-form-row">
            <div className="adm-form-field">
              <label className="adm-form-lbl">СТОИМОСТЬ, БАЛЛОВ *</label>
              <input className="adm-form-input" type="number" min="1" required value={costPoints} onChange={e => setCostPoints(e.target.value)} />
            </div>
            <div className="adm-form-field">
              <label className="adm-form-lbl">МИНИМАЛЬНЫЙ УРОВЕНЬ</label>
              <select className="adm-form-input" value={tierRequired} onChange={e => setTierRequired(e.target.value)}>
                {TIER_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">СГОРАЕТ ЧЕРЕЗ (ДНЕЙ, НЕОБЯЗАТЕЛЬНО)</label>
            <input className="adm-form-input" type="number" min="1" value={expiresAfterDays} onChange={e => setExpiresAfterDays(e.target.value)} placeholder="Например 14" />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(242,237,228,0.6)', cursor: 'pointer' }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            Активна (доступна гостям в каталоге)
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

const REDEMPTION_STATUS_LABELS = {
  issued:   { text: 'Выпущено',  color: '#D4A843' },
  redeemed: { text: 'Погашено',  color: '#22c55e' },
  expired:  { text: 'Истекло',   color: '#6b7280' },
};

function TabLoyalty() {
  const { toast } = useFeedback();
  const [tick,      setTick]      = useState(0);
  const [rewards,   setRewards]   = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [confirm,   setConfirm]   = useState(null);

  const [rules,       setRules]       = useState(null);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesSaved,  setRulesSaved]  = useState(false);

  const [redemptions,       setRedemptions]       = useState([]);
  const [redemptionFilter,  setRedemptionFilter]  = useState('');

  const [searchCode,   setSearchCode]   = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [searchErr,    setSearchErr]    = useState('');

  useEffect(() => { LoyaltyService.getAllRewards().then(setRewards).catch(() => {}); }, [tick]);
  useEffect(() => { LoyaltyService.getRules().then(setRules).catch(() => {}); }, []);
  useEffect(() => {
    LoyaltyService.getRedemptions(redemptionFilter || undefined).then(setRedemptions).catch(() => {});
  }, [redemptionFilter, tick]);

  async function handleSaveReward(data) {
    if (editing) await LoyaltyService.updateReward(editing.id, data);
    else await LoyaltyService.createReward(data);
    setShowModal(false);
    setEditing(null);
    setTick(n => n + 1);
  }

  function handleDeleteReward(r) {
    setConfirm({
      title: 'Удалить награду',
      message: `Удалить «${r.title}» без возможности восстановления?`,
      confirmLabel: 'Удалить',
      onConfirm: async () => {
        await LoyaltyService.deleteReward(r.id);
        setConfirm(null);
        setTick(n => n + 1);
      },
    });
  }

  async function handleToggleActive(r) {
    await LoyaltyService.updateReward(r.id, { active: !r.active });
    setTick(n => n + 1);
  }

  function setTierPoints(tierKey, value) {
    setRules(r => ({ ...r, attendancePoints: { ...r.attendancePoints, [tierKey]: parseInt(value) || 0 } }));
  }

  async function handleSaveRules() {
    setRulesSaving(true);
    try {
      await LoyaltyService.setRules(rules);
      setRulesSaved(true);
      setTimeout(() => setRulesSaved(false), 2000);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRulesSaving(false);
    }
  }

  async function handleSearch(e) {
    e.preventDefault();
    setSearchErr('');
    setSearchResult(null);
    const code = searchCode.trim().toUpperCase();
    if (!code) return;
    try {
      const result = await LoyaltyService.confirmRedemption(code);
      setSearchResult(result);
      setSearchCode('');
      setTick(n => n + 1);
    } catch (ex) {
      setSearchErr(ex.message);
    }
  }

  return (
    <div className="adm-tab">
      <p className="adm-tab__desc">
        Награды каталога лояльности (видны гостям во вкладке «Уровень»), правила начисления баллов и погашение по коду.
      </p>
      <div className="adm-filters">
        <div style={{ flex: 1 }} />
        <button className="adm-btn adm-btn--primary" onClick={() => { setEditing(null); setShowModal(true); }}>
          + Добавить награду
        </button>
      </div>

      {rewards.length === 0 ? (
        <div className="adm-empty">Наград пока нет</div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>Название</th><th>Баллы</th><th>Уровень</th><th>Сгорает</th><th>Активна</th><th></th></tr>
            </thead>
            <tbody>
              {rewards.map(r => (
                <tr key={r.id} className={!r.active ? 'adm-table__row--muted' : ''}>
                  <td className="adm-table__name">{r.title}</td>
                  <td>{r.costPoints} ★</td>
                  <td>{r.tierRequired ? TIER_LABEL_BY_KEY[r.tierRequired] : '—'}</td>
                  <td>{r.expiresAfterDays ? `${r.expiresAfterDays} дн.` : '—'}</td>
                  <td>{r.active ? '✓ Да' : '— Нет'}</td>
                  <td>
                    <div className="adm-actions">
                      <button className="adm-act-btn adm-act-btn--ok" onClick={() => { setEditing(r); setShowModal(true); }} title="Редактировать">✎</button>
                      <button className="adm-act-btn adm-act-btn--move" onClick={() => handleToggleActive(r)} title={r.active ? 'Выключить' : 'Включить'}>{r.active ? '⏸' : '▶'}</button>
                      <button className="adm-act-btn adm-act-btn--del" onClick={() => handleDeleteReward(r)} title="Удалить">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="adm-tab__desc" style={{ marginTop: 32 }}>
        Баллы за подтверждённый визит (бронь/событие) — по текущему уровню гостя.
      </p>
      {rules && (
        <div className="adm-filters" style={{ flexWrap: 'wrap' }}>
          {['kitten', 'jazzcat', 'oldpaw', 'boss'].map(key => (
            <div className="adm-form-field" key={key} style={{ minWidth: 130 }}>
              <label className="adm-form-lbl">{TIER_LABEL_BY_KEY[key]}</label>
              <input className="adm-form-input" type="number" min="0"
                value={rules.attendancePoints[key]}
                onChange={e => setTierPoints(key, e.target.value)} />
            </div>
          ))}
          <button className={`adm-btn ${rulesSaved ? 'adm-btn--saved' : 'adm-btn--primary'}`} onClick={handleSaveRules} disabled={rulesSaving} style={{ alignSelf: 'flex-end' }}>
            {rulesSaved ? '✓ Сохранено' : rulesSaving ? 'Сохраняем…' : 'Сохранить правила'}
          </button>
        </div>
      )}

      <p className="adm-tab__desc" style={{ marginTop: 32 }}>
        Погашение по коду вручную — если гость показал код, а сканировать через Telegram не хочется.
      </p>
      <form className="adm-filters" onSubmit={handleSearch}>
        <input className="adm-select" style={{ textTransform: 'uppercase', fontFamily: 'monospace', width: 120 }}
          type="text" maxLength={6} placeholder="КОД" value={searchCode} onChange={e => setSearchCode(e.target.value.toUpperCase())} />
        <button className="adm-btn adm-btn--primary" type="submit">Погасить</button>
      </form>
      {searchErr && <div className="adm-error">{searchErr}</div>}
      {searchResult && (
        <div className="adm-error" style={{ background: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.25)', color: '#22c55e' }}>
          ✓ Погашено: «{searchResult.reward?.title}» — списано {searchResult.redemption.pointsSpent} баллов.
        </div>
      )}

      <p className="adm-tab__desc" style={{ marginTop: 32 }}>Последние погашения.</p>
      <div className="adm-filters">
        <select className="adm-select" value={redemptionFilter} onChange={e => setRedemptionFilter(e.target.value)}>
          <option value="">Все статусы</option>
          <option value="issued">Выпущено</option>
          <option value="redeemed">Погашено</option>
          <option value="expired">Истекло</option>
        </select>
      </div>
      {redemptions.length === 0 ? (
        <div className="adm-empty">Погашений пока нет</div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>Дата</th><th>Код</th><th>Награда</th><th>Гость</th><th>Баллы</th><th>Статус</th></tr>
            </thead>
            <tbody>
              {redemptions.map(r => {
                const st = REDEMPTION_STATUS_LABELS[r.status] || { text: r.status, color: '#888' };
                return (
                  <tr key={r.id}>
                    <td>{formatDate(r.createdAt.split('T')[0])}</td>
                    <td style={{ fontFamily: 'monospace' }}>{r.code}</td>
                    <td className="adm-table__name">{r.rewardTitle}</td>
                    <td>{r.guestName}</td>
                    <td>{r.pointsSpent}</td>
                    <td>
                      <span className="adm-badge" style={{ color: st.color, background: st.color + '18', borderColor: st.color + '44' }}>{st.text}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <RewardModal initial={editing} onSave={handleSaveReward} onClose={() => { setShowModal(false); setEditing(null); }} />
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

// ─── Floor plan editor ───────────────────────────────────────────
const EDR_ZONES = ['Основной зал', 'VIP', 'Диваны'];
const SNAP_GRID = 600;
const noPtr2 = { pointerEvents: 'none' };
const noSel2 = { pointerEvents: 'none', userSelect: 'none' };

function clampVal(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function AddTableModal({ onAdd, onClose }) {
  const [type,  setType]  = useState('round');
  const [zone,  setZone]  = useState('Основной зал');
  const [count, setCount] = useState('4');

  function handleSubmit(e) {
    e.preventDefault();
    const n = parseInt(count) || 4;
    const seats = Array.from({ length: n }, (_, i) => ({
      angle: Math.round(360 * i / n),
      active: true,
    }));
    const data = type === 'round'
      ? { type, zone, cx: 15000, cy: 10800, radius: 1500, depositPrice: 0, seats }
      : { type, zone, x: 14400, y: 9600, w: 2700, h: 2700, depositPrice: 0, seats };
    onAdd(data);
  }

  return (
    <div className="adm-modal-overlay" onClick={onClose}>
      <div className="adm-modal" onClick={e => e.stopPropagation()}>
        <div className="adm-modal__head">
          <span className="adm-modal__title">Добавить стол</span>
          <button className="adm-modal__close" onClick={onClose}>✕</button>
        </div>
        <form className="adm-modal__form" onSubmit={handleSubmit}>
          <div className="adm-form-row">
            <div className="adm-form-field">
              <label className="adm-form-lbl">ТИП</label>
              <select className="adm-form-input" value={type} onChange={e => setType(e.target.value)}>
                <option value="round">Круглый</option>
                <option value="square">Квадратный</option>
              </select>
            </div>
            <div className="adm-form-field">
              <label className="adm-form-lbl">ЗОНА</label>
              <select className="adm-form-input" value={zone} onChange={e => setZone(e.target.value)}>
                {EDR_ZONES.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
          </div>
          <div className="adm-form-field">
            <label className="adm-form-lbl">КОЛ-ВО МЕСТ</label>
            <select className="adm-form-input" value={count} onChange={e => setCount(e.target.value)}>
              {['2','3','4','5','6','7','8'].map(n => <option key={n}>{n}</option>)}
            </select>
          </div>
          <p style={{ fontSize: 11, color: 'rgba(242,237,228,0.3)', margin: 0 }}>
            Стол появится в центре плана. Перетащите на нужное место.
          </p>
          <button className="adm-btn adm-btn--primary" type="submit">Добавить</button>
        </form>
      </div>
    </div>
  );
}

function EditorPanel({ table: t, onSeatToggle, onRemove, onSaveDeposit }) {
  const [price, setPrice] = useState(t.depositPrice ?? 0);
  const [saved, setSaved] = useState(false);
  const activeCount = t.seats.filter(s => s.active).length;
  const pos = t.type === 'round'
    ? `cx ${Math.round(t.cx)}  cy ${Math.round(t.cy)}`
    : t.type === 'bar'
    ? `bx ${Math.round(t.bx)}  by ${Math.round(t.by)}`
    : `x ${Math.round(t.x)}  y ${Math.round(t.y)}`;

  async function handleSaveDeposit() {
    await onSaveDeposit(t.id, price);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="adm-editor__panel-content">
      <div className="adm-editor__panel-head">
        <span className="adm-table__table-id">{t.id}</span>
        <span className="adm-editor__panel-zone">{t.zone}</span>
      </div>
      <div className="adm-editor__panel-row">
        <span className="adm-form-lbl">ТИП</span>
        <span>{t.type}</span>
      </div>
      <div className="adm-editor__panel-row">
        <span className="adm-form-lbl">ПОЗИЦИЯ</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>{pos}</span>
      </div>

      <div className="adm-form-field">
        <label className="adm-form-lbl">ДЕПОЗИТ, ₽</label>
        <div className="adm-editor__deposit-row">
          <input
            className="adm-price-input"
            type="number" min="0" step="100"
            value={price}
            onChange={e => setPrice(e.target.value)}
          />
          <button className={`adm-btn ${saved ? 'adm-btn--saved' : 'adm-btn--ghost'}`} onClick={handleSaveDeposit}>
            {saved ? '✓ Сохранено' : 'Сохранить'}
          </button>
        </div>
      </div>

      <div className="adm-editor__seats-title">МЕСТА ({activeCount} / {t.seats.length})</div>
      <div className="adm-seats-grid">
        {t.seats.map((seat, i) => (
          <button key={i}
            className={`adm-seat-btn${seat.active ? ' adm-seat-btn--active' : ''}`}
            onClick={() => onSeatToggle(t.id, i, seat.active)}
            title={`Место ${i + 1}: ${seat.angle}°`}>
            {i + 1}
          </button>
        ))}
      </div>
      <button className="adm-btn adm-btn--ghost adm-editor__del-btn" onClick={() => onRemove(t.id)}>
        Убрать с плана
      </button>
    </div>
  );
}

// План v2: квадратный viewBox 30000×30000 (см. src/booking/tablesConfig.js)
const VB_FULL = { x: 0, y: 0, w: 30000, h: 30000 };
const VB_ASPECT = 30000 / 30000;
const VB_MIN_W = 7400;

function FloorEditor() {
  const svgRef = useRef(null);
  const [tables,       setTables]       = useState([]);
  const [selectedId,   setSelectedId]   = useState(null);
  const [hoveredId,    setHoveredId]    = useState(null);
  const [dragging,     setDragging]     = useState(null);
  const [dragPos,      setDragPos]      = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewBox,      setViewBox]      = useState(VB_FULL);
  const [panning,      setPanning]      = useState(null);
  const [confirm,      setConfirm]      = useState(null);
  const [tick,         setTick]         = useState(0);

  useEffect(() => {
    BookingService.getTablesMerged().then(setTables).catch(() => {});
  }, [tick]);

  // Wheel-to-zoom toward the cursor. Attached non-passively so preventDefault works.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e) {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width;
      const my = (e.clientY - rect.top) / rect.height;
      setViewBox(vb => {
        const factor = e.deltaY > 0 ? 1.12 : 0.89;
        const newW = Math.max(VB_MIN_W, Math.min(VB_FULL.w, vb.w * factor));
        const newH = newW * VB_ASPECT;
        const wx = vb.x + mx * vb.w;
        const wy = vb.y + my * vb.h;
        return { x: wx - mx * newW, y: wy - my * newH, w: newW, h: newH };
      });
    }
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const selectedTable = tables.find(t => t.id === selectedId) || null;

  function svgPt(e) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function handleMouseDown(e, tbl) {
    e.stopPropagation();
    e.preventDefault();
    setSelectedId(tbl.id);
    const { x, y } = svgPt(e);
    const orig = tbl.type === 'round' ? { cx: tbl.cx, cy: tbl.cy }
      : tbl.type === 'bar' ? { bx: tbl.bx, by: tbl.by }
      : { x: tbl.x, y: tbl.y };
    setDragging({ id: tbl.id, type: tbl.type, startX: x, startY: y, orig });
  }

  // Mouse-down on empty canvas starts a pan (and deselects).
  function handleBgMouseDown(e) {
    if (dragging) return;
    setSelectedId(null);
    const rect = svgRef.current.getBoundingClientRect();
    setPanning({ startX: e.clientX, startY: e.clientY, origX: viewBox.x, origY: viewBox.y, scale: viewBox.w / rect.width });
  }

  function handleSvgMouseMove(e) {
    if (dragging) {
      // Snap the absolute final position to the grid, not the raw drag delta —
      // otherwise a table whose starting position isn't itself grid-aligned
      // would never actually land on a grid line, however far it's dragged.
      const { x, y } = svgPt(e);
      const snap = v => Math.round(v / SNAP_GRID) * SNAP_GRID;
      if (dragging.type === 'round') {
        const cx = snap(dragging.orig.cx + (x - dragging.startX));
        const cy = snap(dragging.orig.cy + (y - dragging.startY));
        setDragPos({ cx: clampVal(cx, 1600, 28100), cy: clampVal(cy, 1600, 19400) });
      } else if (dragging.type === 'bar') {
        const bx = snap(dragging.orig.bx + (x - dragging.startX));
        const by = snap(dragging.orig.by + (y - dragging.startY));
        setDragPos({ bx: clampVal(bx, 200, 28300), by: clampVal(by, 200, 19700) });
      } else {
        const nx = snap(dragging.orig.x + (x - dragging.startX));
        const ny = snap(dragging.orig.y + (y - dragging.startY));
        setDragPos({ x: clampVal(nx, 400, 26000), y: clampVal(ny, 400, 17900) });
      }
      return;
    }
    if (panning) {
      const dx = (e.clientX - panning.startX) * panning.scale;
      const dy = (e.clientY - panning.startY) * panning.scale;
      setViewBox(vb => ({ ...vb, x: panning.origX - dx, y: panning.origY - dy }));
    }
  }

  function endInteraction() {
    if (dragging && dragPos) {
      BookingService.setTablePosition(dragging.id, dragPos)
        .then(() => setTick(n => n + 1))
        .catch(() => {});
    }
    setDragging(null);
    setDragPos(null);
    setPanning(null);
  }

  function effPos(tbl) {
    if (dragging?.id === tbl.id && dragPos) return dragPos;
    if (tbl.type === 'round') return { cx: tbl.cx, cy: tbl.cy };
    if (tbl.type === 'bar')   return { bx: tbl.bx, by: tbl.by };
    return { x: tbl.x, y: tbl.y };
  }

  async function handleSeatToggle(tableId, i, cur) {
    await BookingService.setTableSeatActive(tableId, i, !cur);
    setTick(n => n + 1);
  }

  async function handleSaveDeposit(tableId, price) {
    await BookingService.setTableDepositPrice(tableId, price);
    setTick(n => n + 1);
  }

  function handleRemoveTable(tableId) {
    setConfirm({
      title: 'Убрать стол',
      message: `Убрать стол ${tableId} с плана зала? Существующие брони не затрагиваются.`,
      confirmLabel: 'Убрать',
      onConfirm: async () => {
        await BookingService.removeTable(tableId);
        setSelectedId(null);
        setTick(n => n + 1);
        setConfirm(null);
      },
    });
  }

  async function handleAddTable(data) {
    await BookingService.addCustomTable(data);
    setShowAddModal(false);
    setTick(n => n + 1);
  }

  function handleResetLayout() {
    setConfirm({
      title: 'Сбросить расположение',
      message: 'Сбросить расположение столов к исходному? Цены депозитов и состояние мест сохранятся.',
      confirmLabel: 'Сбросить',
      onConfirm: async () => {
        await BookingService.resetTableLayout();
        setSelectedId(null);
        setTick(n => n + 1);
        setConfirm(null);
      },
    });
  }

  return (
    <div className="adm-editor">
      <div className="adm-editor__toolbar">
        <button className="adm-btn adm-btn--primary" onClick={() => setShowAddModal(true)}>+ Добавить стол</button>
        <button className="adm-btn adm-btn--ghost" onClick={handleResetLayout}>Сбросить расположение</button>
        {viewBox.w < VB_FULL.w && (
          <button className="adm-btn adm-btn--ghost" onClick={() => setViewBox(VB_FULL)}>Сбросить зум</button>
        )}
        <span className="adm-editor__hint">Перетащите стол · колесо = зум · фон = панорама · сетка {SNAP_GRID} ед.</span>
      </div>

      <div className="adm-editor__body">
        <div className="adm-editor__svg-wrap">
          <svg
            ref={svgRef}
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            className="adm-editor__svg"
            preserveAspectRatio="xMidYMid meet"
            style={{ userSelect: 'none', cursor: panning ? 'grabbing' : 'default' }}
            onMouseDown={handleBgMouseDown}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={endInteraction}
            onMouseLeave={endInteraction}
          >
            <defs>
              <pattern id="edr-g" x={0} y={0} width={SNAP_GRID} height={SNAP_GRID} patternUnits="userSpaceOnUse">
                <path d={`M${SNAP_GRID} 0L0 0 0 ${SNAP_GRID}`} fill="none" stroke="rgba(212,168,67,0.06)" strokeWidth={8} />
              </pattern>
              {/* Major grid every 5 cells, like a CAD/design-tool ruler — gives the plan a sense of scale. */}
              <pattern id="edr-g-major" x={0} y={0} width={SNAP_GRID * 5} height={SNAP_GRID * 5} patternUnits="userSpaceOnUse">
                <path d={`M${SNAP_GRID * 5} 0L0 0 0 ${SNAP_GRID * 5}`} fill="none" stroke="rgba(212,168,67,0.14)" strokeWidth={12} />
              </pattern>
              <filter id="edr-shadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="0" stdDeviation="90" floodColor="#D4A843" floodOpacity="0.45" />
              </filter>
            </defs>
            {/* Фон-обстановка плана v2 (та же геометрия, что в FloorPlanSvg) */}
            <rect width={30000} height={30000} fill="#080616" />
            <rect width={30000} height={30000} fill="url(#edr-g)" style={noPtr2} />
            <rect width={30000} height={30000} fill="url(#edr-g-major)" style={noPtr2} />
            <rect x={7980} y={0} width={13200} height={4093} rx={200}
              fill="rgba(212,168,67,0.04)" stroke="rgba(212,168,67,0.16)" strokeWidth={40} style={noPtr2} />
            <text x={14580} y={2350} textAnchor="middle" fill="rgba(212,168,67,0.14)"
              fontSize={750} fontFamily="Avenir Next,sans-serif" letterSpacing={180} style={noSel2}>БАР</text>
            <path d="M27322.13 2749.55c-6992.43,3818.13 -18287.38,3819.15 -25228,2.29"
              fill="none" stroke="rgba(242,237,228,0.10)" strokeWidth={44} style={noPtr2} />
            <rect x={244} y={7206} width={1156} height={7330} rx={200}
              fill="rgba(155,93,229,0.04)" stroke="rgba(155,93,229,0.10)" strokeWidth={30} style={noPtr2} />
            <rect x={290} y={15919} width={1156} height={7330} rx={200}
              fill="rgba(155,93,229,0.04)" stroke="rgba(155,93,229,0.10)" strokeWidth={30} style={noPtr2} />

            {tables.map(tbl => {
              const isSel = tbl.id === selectedId;
              const isDrg = dragging?.id === tbl.id;
              const isHov = tbl.id === hoveredId && !isSel && !isDrg;
              const pos = effPos(tbl);
              const sc  = isSel ? '#D4A843' : isHov ? 'rgba(212,168,67,0.55)' : 'rgba(212,168,67,0.30)';
              const sw  = isSel ? 80 : isHov ? 55 : 40;
              const fl  = isSel ? 'rgba(212,168,67,0.14)' : isHov ? 'rgba(212,168,67,0.09)' : 'rgba(212,168,67,0.05)';
              const lbl = isSel ? '#D4A843' : 'rgba(242,237,228,0.45)';

              return (
                <g key={tbl.id} style={{ cursor: isDrg ? 'grabbing' : 'grab' }}
                  filter={(isSel || isDrg) ? 'url(#edr-shadow)' : undefined}
                  onMouseDown={e => handleMouseDown(e, tbl)}
                  onMouseEnter={() => setHoveredId(tbl.id)}
                  onMouseLeave={() => setHoveredId(id => id === tbl.id ? null : id)}
                  onClick={e => { e.stopPropagation(); setSelectedId(tbl.id); }}>
                  {tbl.type === 'round' ? (
                    <>
                      <circle cx={pos.cx} cy={pos.cy} r={1500} fill={fl} stroke={sc} strokeWidth={sw} />
                      <text x={pos.cx} y={pos.cy + 220} textAnchor="middle"
                        fill={lbl} fontSize={520} fontFamily="Avenir Next,sans-serif" fontWeight={700} style={noSel2}>{tbl.id}</text>
                    </>
                  ) : tbl.type === 'bar' ? (
                    <>
                      <rect x={pos.bx} y={pos.by} width={BAR_STOOL_W} height={BAR_STOOL_H} rx={215} fill={fl} stroke={sc} strokeWidth={isSel ? 50 : 28} />
                      <text x={pos.bx + BAR_STOOL_W / 2} y={pos.by + BAR_STOOL_H / 2 + 95} textAnchor="middle"
                        fill={lbl} fontSize={250} fontFamily="Avenir Next,sans-serif" fontWeight={700} style={noSel2}>{tbl.id}</text>
                    </>
                  ) : (
                    <>
                      <rect x={pos.x} y={pos.y} width={tbl.w} height={tbl.h} rx={220} fill={fl} stroke={sc} strokeWidth={sw} />
                      <text x={pos.x + tbl.w / 2} y={pos.y + tbl.h / 2 + 220} textAnchor="middle"
                        fill={lbl} fontSize={520} fontFamily="Avenir Next,sans-serif" fontWeight={700} style={noSel2}>{tbl.id}</text>
                    </>
                  )}
                  {tbl.type !== 'bar' && tbl.seats.map((seat, i) => {
                    const rad = seat.angle * Math.PI / 180;
                    const r   = tbl.type === 'round' ? (tbl.radius || 1500) + 120 : Math.max(tbl.w, tbl.h) / 2 + 220;
                    const ox  = tbl.type === 'round' ? pos.cx : pos.x + tbl.w / 2;
                    const oy  = tbl.type === 'round' ? pos.cy : pos.y + tbl.h / 2;
                    return (
                      <circle key={i} cx={ox + r * Math.cos(rad)} cy={oy + r * Math.sin(rad)} r={160}
                        fill={seat.active ? 'rgba(34,197,94,0.6)' : 'rgba(242,237,228,0.08)'} style={noPtr2} />
                    );
                  })}
                </g>
              );
            })}

            {/* Ghost outline at the drag origin */}
            {dragging && dragPos && (() => {
              const o = dragging.orig;
              const gp = { fill: 'none', stroke: 'rgba(212,168,67,0.28)', strokeWidth: 30, strokeDasharray: '140 100', style: noPtr2 };
              if (dragging.type === 'round') return <circle cx={o.cx} cy={o.cy} r={1500} {...gp} />;
              if (dragging.type === 'bar')   return <rect x={o.bx} y={o.by} width={BAR_STOOL_W} height={BAR_STOOL_H} rx={215} {...gp} />;
              const t = tables.find(tt => tt.id === dragging.id);
              return <rect x={o.x} y={o.y} width={t?.w || 2700} height={t?.h || 2700} rx={220} {...gp} />;
            })()}
          </svg>
        </div>

        <div className="adm-editor__panel">
          {selectedTable
            ? <EditorPanel key={selectedTable.id} table={selectedTable} onSeatToggle={handleSeatToggle} onRemove={handleRemoveTable} onSaveDeposit={handleSaveDeposit} />
            : <div className="adm-editor__panel-empty">Кликните на стол, чтобы выбрать</div>
          }
        </div>
      </div>

      {showAddModal && <AddTableModal onAdd={handleAddTable} onClose={() => setShowAddModal(false)} />}
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

// ─── Styled confirm modal (replaces window.confirm) ──────────────
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

// ─── Tab: РЕДАКТОР ───────────────────────────────────────────────
function TabEditor() {
  return <FloorEditor />;
}

// ─── Page ────────────────────────────────────────────────────────
export default function AdminPage() {
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
        {[['reservations','БРОНИ'],['editor','РЕДАКТОР'],['menu','МЕНЮ'],['events','СОБЫТИЯ'],['reviews','ОТЗЫВЫ'],['team','КОМАНДА'],['loyalty','ЛОЯЛЬНОСТЬ']].map(([key, label]) => (
          <button key={key}
            className={`adm-tab-btn${tab === key ? ' adm-tab-btn--active' : ''}`}
            onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      <main className="adm-main">
        {tab === 'reservations' && <TabReservations adminId={user.id} />}
        {tab === 'editor'       && <TabEditor />}
        {tab === 'menu'         && <TabMenu />}
        {tab === 'events'       && <TabEvents />}
        {tab === 'reviews'      && <TabReviews />}
        {tab === 'team'         && <TabTeam />}
        {tab === 'loyalty'      && <TabLoyalty />}
      </main>
    </div>
  );
}
