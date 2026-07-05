import { useState, useEffect } from 'react';
import { useReveal } from '../useReveal.js';
import TeamService from '../team/TeamService.js';
import ApplicationsService from '../team/ApplicationsService.js';

// Секция «Бармены» v2 (макет владельца, 2026-07-05): слева большой портрет,
// в центре имя/должность/стаж + биография + книжная цитата с источником,
// справа навигация по сотрудникам (кнопки с фото-фоном, кадр по глазам) и
// блок «попасть в команду». Стрелки-переключалки убраны — только кнопки.
// Если у бармена не заполнена цитата в админке, берём из запасного пула
// (реальные цитаты с источниками — не выдумки).
const FALLBACK_QUOTES = [
  { text: 'Пейте быстро, пока коктейль смеётся над вами!', source: 'Гарри Крэддок, «The Savoy Cocktail Book»' },
  { text: 'Я могу устоять перед чем угодно, кроме искушения.', source: 'Оскар Уайльд, «Веер леди Уиндермир»' },
  { text: 'Один мартини — в самый раз, два — слишком много, три — недостаточно.', source: 'Джеймс Тёрбер' },
  { text: 'Вино — одна из самых цивилизованных вещей на свете.', source: 'Эрнест Хемингуэй, «Смерть после полудня»' },
];

export default function Team({ tx }) {
  const [members,  setMembers]  = useState([]);
  const [idx,      setIdx]      = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const r0 = useReveal(0);

  useEffect(() => {
    let alive = true;
    TeamService.getPublic()
      .then(list => { if (alive) setMembers(list); })
      .catch(() => { if (alive) setMembers([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const current = members[idx];
  const quote = current?.quote
    ? { text: current.quote.replace(/^«|»$/g, ''), source: current.quoteSource }
    : FALLBACK_QUOTES[idx % FALLBACK_QUOTES.length];

  return (
    <section id="team" className="team">
      <div className="team__inner team__inner--profile">
        <div ref={r0} className="reveal" style={{ textAlign: 'center' }}>
          <span className="sec-label">{tx.teamLabel}</span>
        </div>

        {loading && <p className="team__note">{tx.teamLoading}</p>}
        {!loading && !current && <p className="team__note">{tx.teamEmpty}</p>}

        {!loading && current && (
          <div className="tm2">
            {/* Портрет */}
            <div className="tm2__photo" key={current.id}>
              {current.photoUrl && <img src={current.photoUrl} alt={current.name} loading="lazy" />}
            </div>

            {/* Имя · должность · стаж */}
            <header className="tm2__head">
              <h2 className="tm2__name">{current.name}</h2>
              {current.role && <div className="tm2__role">{current.role}</div>}
              {current.spec && <div className="tm2__spec">{current.spec}</div>}
            </header>

            {/* Биография + книжная цитата */}
            <div className="tm2__body">
              {current.bio && <p className="tm2__bio">{current.bio}</p>}
              {quote && (
                <figure className="tm2__quote">
                  <blockquote className="tm2__quote-text">«{quote.text}»</blockquote>
                  {quote.source && <figcaption className="tm2__quote-src">— {quote.source}</figcaption>}
                </figure>
              )}
            </div>

            {/* Навигация по сотрудникам + анкета */}
            <aside className="tm2__side">
              <nav className="tm2__nav" aria-label="Наши бармены">
                {members.map((m, i) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`tm2__nav-btn${i === idx ? ' tm2__nav-btn--active' : ''}`}
                    style={{
                      '--i': i,
                      backgroundImage: m.photoUrl
                        ? `linear-gradient(90deg, rgba(9,7,18,.86) 34%, rgba(9,7,18,.30)), url(${m.photoUrl})`
                        : undefined,
                    }}
                    onClick={() => setIdx(i)}
                  >
                    <span className="tm2__nav-name">{m.name}</span>
                  </button>
                ))}
              </nav>

              <div className="tm2__join">
                <p className="tm2__join-text">{tx.teamJoinAsk}</p>
                <button className="tm2__join-btn" onClick={() => setShowForm(true)}>{tx.teamJoinShare}</button>
              </div>
            </aside>
          </div>
        )}
      </div>

      {showForm && <JoinModal tx={tx} onClose={() => setShowForm(false)} />}
    </section>
  );
}

function JoinModal({ tx, onClose }) {
  const [name,       setName]       = useState('');
  const [phone,      setPhone]      = useState('');
  const [experience, setExperience] = useState('');
  const [sending,    setSending]    = useState(false);
  const [done,       setDone]       = useState(false);
  const [err,        setErr]        = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setSending(true);
    try {
      await ApplicationsService.submit({ name, phone, experience });
      setDone(true);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="team-modal-overlay" onClick={onClose}>
      <div className="team-modal" onClick={e => e.stopPropagation()}>
        <button className="team-modal__close" onClick={onClose} aria-label="Закрыть">✕</button>
        {done ? (
          <div className="team-modal__success">
            <div className="team-modal__success-icon">✓</div>
            <p>{tx.teamJoinSuccess}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="team-modal__form">
            <h3 className="team-modal__title">{tx.teamJoinBtn}</h3>
            <input
              className="team-modal__input" type="text" required
              placeholder={tx.teamJoinName} value={name} onChange={e => setName(e.target.value)}
            />
            <input
              className="team-modal__input" type="tel" required
              placeholder={tx.teamJoinPhone} value={phone} onChange={e => setPhone(e.target.value)}
            />
            <textarea
              className="team-modal__input team-modal__textarea" rows={3}
              placeholder={tx.teamJoinExp} value={experience} onChange={e => setExperience(e.target.value)}
            />
            {err && <div className="team-modal__error">{err}</div>}
            <button className="team-modal__submit" type="submit" disabled={sending}>
              {sending ? '…' : tx.teamJoinSend}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
