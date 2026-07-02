import { useState, useEffect } from 'react';
import { useReveal } from '../useReveal.js';
import TeamService from '../team/TeamService.js';
import ApplicationsService from '../team/ApplicationsService.js';
import PageBackdrop from './PageBackdrop.jsx';

export default function Team({ tx }) {
  const [members,  setMembers]  = useState([]);
  const [idx,      setIdx]      = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const r0   = useReveal(0);
  const r1   = useReveal(100);
  const rSub = useReveal(200);

  useEffect(() => {
    let alive = true;
    TeamService.getPublic()
      .then(list => { if (alive) setMembers(list); })
      .catch(() => { if (alive) setMembers([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const current = members[idx];
  const go = (delta) => setIdx(i => (i + delta + members.length) % members.length);

  return (
    <section id="team" className="team">
      <PageBackdrop image="/uploads/team/team-group.jpg" />
      <div className="team__inner">
        <div ref={r0} className="reveal mb-10">
          <span className="sec-label">{tx.teamLabel}</span>
        </div>
        <h2 ref={r1} className="reveal team__title">{tx.teamTitle}</h2>
        <p ref={rSub} className="reveal team__sub">{tx.teamSub}</p>

        {loading && <p className="team__note">{tx.teamLoading}</p>}
        {!loading && !current && <p className="team__note">{tx.teamEmpty}</p>}

        {!loading && current && (
          <div className="team-carousel">
            <div className="team-carousel__avatar" key={current.id}>
              <img src={current.photoUrl} alt={current.name} loading="lazy" />
            </div>
            <div className="team__name">{current.name}</div>
            {current.role && <div className="team__role">{current.role}</div>}
            {current.spec && <div className="team__spec">{current.spec}</div>}
            {current.quote && (
              <>
                <div className="team__divider" />
                <div className="team__quote">{current.quote}</div>
              </>
            )}

            {members.length > 1 && (
              <div className="team-carousel__nav">
                <button className="team-carousel__arrow" onClick={() => go(-1)} aria-label="Предыдущий">‹</button>
                <div className="team-carousel__dots">
                  {members.map((m, i) => (
                    <button
                      key={m.id}
                      className={`team-carousel__dot${i === idx ? ' team-carousel__dot--active' : ''}`}
                      onClick={() => setIdx(i)}
                      aria-label={m.name}
                    />
                  ))}
                </div>
                <button className="team-carousel__arrow" onClick={() => go(1)} aria-label="Следующий">›</button>
              </div>
            )}
          </div>
        )}

        <div className="team__join">
          <p className="team__join-text">{tx.teamJoinText}</p>
          <button className="team__join-btn" onClick={() => setShowForm(true)}>{tx.teamJoinBtn}</button>
        </div>
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
