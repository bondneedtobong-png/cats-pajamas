import { useState, useEffect } from 'react';
import { useReveal } from '../useReveal.js';
import QuoteFrame from '../ui/QuoteFrame.jsx';
import TeamService from '../team/TeamService.js';
import ApplicationsService from '../team/ApplicationsService.js';

// Секция «Бармены» v3 (макет владельца, 2026-08-27): сверху ряд круглых
// аватарок-переключателей, под ними имя и биография, дальше цитата в латунной
// табличке и лента из трёх кадров — «в работе» (слева, маленький), парадный
// (по центру, крупный) и «в настроении» (справа).
//
// Прежняя раскладка v2 (портрет слева, список-кнопки справа) удалена целиком.
//
// Тексты цитат владелец переписывает заново — до этого во всех карточках стоит
// одна заглушка (QUOTE_STUB), цитаты из БД временно не показываются. Когда
// новые тексты появятся, убрать QUOTE_STUB и вернуть current.quote.
const QUOTE_STUB = 'Упс! Извините, текст временно украли, вернем его чуть позже!';

// Кружки разного размера — как на эскизе владельца. Размер зависит от номера,
// а не от случайности: раскладка не должна прыгать на каждом ре-рендере.
const AVA_SIZES = [104, 128, 92, 116, 98, 122, 88, 110];
const avaSize = (i) => AVA_SIZES[i % AVA_SIZES.length];

// Кадрирование аватарок: портреты сняты с разного расстояния, поэтому у
// каждого свой зум и точка фокуса — подобраны по реальным фото. Ключ — имя
// файла: смена фото в админке вернёт дефолт.
const PHOTO_FOCUS = {
  'shamusar.jpg':  { size: '210% auto', pos: '31% 19%' },
  'aleksey.jpg':   { size: '210% auto', pos: '58% 30%' },
  'vladislav.jpg': { size: '190% auto', pos: '58% 34%' },
  'denis.jpg':     { size: '115% auto', pos: '50% 26%' },
  'dmitriy.jpg':   { size: '210% auto', pos: '54% 20%' },
  'egor.jpg':      { size: '230% auto', pos: '32% 39%' },
};
const DEFAULT_FOCUS = { size: 'cover', pos: '50% 22%' };
const focusFor = (url) => PHOTO_FOCUS[(url || '').split('/').pop()] || DEFAULT_FOCUS;

/** Знак-креманка для пустых слотов — вместо серого прямоугольника. */
function CoupeSign() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M3.5 5.5 L20.5 5.5 L12 15 Z" />
      <path d="M12 15 L12 20 M8 20 L16 20" />
    </svg>
  );
}

/** Кадр ленты: фото или заглушка «снимок скоро». */
function Shot({ url, kind, caption, alt, soon }) {
  return (
    <figure className={`tm3__shot tm3__shot--${kind}${url ? '' : ' tm3__shot--empty'}`}>
      {url
        ? <img src={url} alt={alt} loading="lazy" />
        : <span className="tm3__shot-stub"><CoupeSign /><span className="tm3__shot-soon">{soon}</span></span>}
      <figcaption className="tm3__shot-cap">{caption}</figcaption>
    </figure>
  );
}

export default function Team({ tx }) {
  const [members,  setMembers]  = useState([]);
  const [idx,      setIdx]      = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [bioOpen,  setBioOpen]  = useState(false);
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
  // Длинную биографию в один экран не уместить — показываем начало и даём
  // раскрыть по кнопке (порог подобран по самой длинной биографии команды).
  const bioLong = (current?.bio || '').length > 240;

  return (
    <section id="team" className="team">
      <div className="team__inner team__inner--stage">
        <div ref={r0} className="reveal" style={{ textAlign: 'center' }}>
          <span className="sec-label">{tx.teamLabel}</span>
        </div>

        {loading && <p className="team__note">{tx.teamLoading}</p>}
        {!loading && !current && <p className="team__note">{tx.teamEmpty}</p>}

        {!loading && current && (
          <div className="tm3">
            {/* Ряд аватарок — он же переключатель бармена */}
            <nav className="tm3__ring" aria-label="Наши бармены">
              {members.map((m, i) => {
                const focus = focusFor(m.photoUrl);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`tm3__ava${i === idx ? ' tm3__ava--on' : ''}`}
                    style={{
                      '--ava': `${avaSize(i)}px`,
                      // Кружки стоят не по линейке, а вразнобой — как на эскизе.
                      '--ava-shift': `${((i % 4) - 1.5) * 10}px`,
                      backgroundImage: m.photoUrl ? `url(${m.photoUrl})` : undefined,
                      backgroundSize: focus.size,
                      backgroundPosition: focus.pos,
                    }}
                    aria-pressed={i === idx}
                    onClick={() => { setIdx(i); setBioOpen(false); }}
                  >
                    {!m.photoUrl && <span className="tm3__ava-letter">{m.name.slice(0, 1)}</span>}
                    <span className="tm3__ava-name">{m.name}</span>
                  </button>
                );
              })}
            </nav>

            {/* Имя · должность · стаж */}
            <header className="tm3__head" key={current.id}>
              <h2 className="tm3__name">{current.name}</h2>
              {current.role && <div className="tm3__role">{current.role}</div>}
              {current.spec && <div className="tm3__spec">{current.spec}</div>}
            </header>

            {current.bio && (
              <>
                <p className={`tm3__bio${bioOpen ? ' tm3__bio--open' : ''}`}>{current.bio}</p>
                {bioLong && (
                  <button type="button" className="tm3__bio-more" onClick={() => setBioOpen((v) => !v)}>
                    {bioOpen ? 'Свернуть' : 'Читать дальше'}
                  </button>
                )}
              </>
            )}

            {/* Цитата — латунная табличка (вариант владельца) */}
            <figure className="tm3__quote">
              <QuoteFrame />
              <blockquote className="tm3__quote-text">{QUOTE_STUB}</blockquote>
            </figure>

            {/* Три кадра: в работе · парадный · в настроении */}
            <div className="tm3__shots">
              <Shot kind="work" url={current.photoWorkUrl} caption={tx.teamShotWork} soon={tx.teamShotSoon} alt={`${current.name} за работой`} />
              <Shot kind="hero" url={current.photoUrl} caption={tx.teamShotHero} soon={tx.teamShotSoon} alt={current.name} />
              <Shot kind="fun" url={current.photoFunUrl} caption={tx.teamShotFun} soon={tx.teamShotSoon} alt={`${current.name}, кадр вне смены`} />
            </div>

            <div className="tm3__join">
              <p className="tm3__join-text">{tx.teamJoinAsk}</p>
              <button className="tm3__join-btn u-glare" onClick={() => setShowForm(true)}>{tx.teamJoinShare}</button>
            </div>
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
