import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useReveal } from '../useReveal.js';
import QuoteFrame from '../ui/QuoteFrame.jsx';
import TeamService from '../team/TeamService.js';
import ApplicationsService from '../team/ApplicationsService.js';

// Секция «Бармены» v4 (макет владельца от 2026-08-27, нарисован фигурами
// поверх скриншота): сверху ряд КРУПНЫХ круглых аватарок-переключателей во всю
// ширину, внизу две плашки на одной высоте — цитата слева, описание бармена
// справа (имя + должность + стаж + биография одним блоком).
//
// Почему так мало элементов: v3 разваливалась не от размеров, а от количества
// одновременно видимых блоков — метка главы, крупное имя, роль, стаж, био с
// «читать дальше», цитата, лента из трёх кадров и кнопка «стать бартендером»
// делили один экран, и акцента не оставалось. Всё лишнее ниже завёрнуто в
// `{false && (…)}` с пометкой TODO: код и данные (photoWorkUrl/photoFunUrl,
// админка «КОМАНДА») целы, эти поля просто временно нигде не рендерятся.
//
// Тексты цитат владелец переписывает заново — до этого во всех карточках стоит
// одна заглушка (QUOTE_STUB), цитаты из БД временно не показываются. Когда
// новые тексты появятся, убрать QUOTE_STUB и вернуть current.quote.
const QUOTE_STUB = 'Упс! Извините, текст временно украли, вернем его чуть позже!';

/**
 * Размер аватарки под ширину ряда (требование владельца 2026-08-27).
 * Ряд обязан помещаться в ОДНУ строку при любом числе барменов: список тянется
 * из админки и будет расти. Значит, диаметр и зазор считаются от реальной
 * ширины контейнера, а чистым CSS это не выразить — отсюда замер в JS.
 * Прежний потолок `min(var(--ava), 9.5vh)` зажимал кружок в ~85–103px на
 * десктопе; теперь ограничение только по ширине ряда.
 */
const AVA_MIN = 76;   // мельче — уже не лица, а точки
const AVA_MAX = 420;  // ~втрое больше прежнего; срабатывает при 2–4 барменах
const AVA_VH  = 0.34; // потолок по высоте: иначе при малом составе ряд перерастает экран
const RING_MOBILE_MAX = 900; // ниже — лента с прокруткой, диаметр из CSS

function fitRing(el, count) {
  const width = el.clientWidth;
  if (!width || !count) return;
  if (window.innerWidth <= RING_MOBILE_MAX) {
    el.style.removeProperty('--tm3-ava');
    el.style.removeProperty('--tm3-gap');
    return;
  }
  let gap = Math.max(4, Math.min(20, width * 0.008));
  let d = (width - gap * (count - 1)) / count;
  d = Math.min(AVA_MAX, window.innerHeight * AVA_VH, Math.max(AVA_MIN, d));
  // Барменов стало столько, что даже минимальный кружок не влезает — жертвуем
  // минимумом, но НЕ переносим ряд на вторую строку и не даём горизонтальный скролл.
  if (d * count + gap * (count - 1) > width) {
    gap = 4;
    d = (width - gap * (count - 1)) / count;
  }
  el.style.setProperty('--tm3-ava', Math.floor(d) + 'px');
  el.style.setProperty('--tm3-gap', Math.round(gap) + 'px');
}

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
  'lelya.jpg':     { size: '235% auto', pos: '47% 20%' },
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
  const ringRef = useRef(null);

  useEffect(() => {
    let alive = true;
    TeamService.getPublic()
      .then(list => { if (alive) setMembers(list); })
      .catch(() => { if (alive) setMembers([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Пересчёт диаметра: при монтировании, смене числа барменов и любом ресайзе
  // контейнера. ResizeObserver ловит и то, чего не видит window.resize
  // (например, появление вертикального скроллбара).
  useLayoutEffect(() => {
    const el = ringRef.current;
    if (!el) return;
    const fit = () => fitRing(el, members.length);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [members.length]);

  const current = members[idx];
  // Длинную биографию в один экран не уместить — показываем начало и даём
  // раскрыть по кнопке (порог подобран по самой длинной биографии команды).
  const bioLong = (current?.bio || '').length > 240;

  return (
    <section id="team" className="team">
      <div className="team__inner team__inner--stage">
        {/* TODO(2026-08-27): метка главы временно скрыта по ТЗ владельца —
            вернуть после утверждения новой раскладки. Нумерация глав в
            src/data.js не тронута. */}
        {false && (
          <div ref={r0} className="reveal" style={{ textAlign: 'center' }}>
            <span className="sec-label">{tx.teamLabel}</span>
          </div>
        )}

        {loading && <p className="team__note">{tx.teamLoading}</p>}
        {!loading && !current && <p className="team__note">{tx.teamEmpty}</p>}

        {!loading && current && (
          <div className="tm3">
            {/* Ряд аватарок — он же переключатель бармена. Диаметр и зазор
                считает fitRing (см. выше) и кладёт инлайном в CSS-переменные. */}
            <nav className="tm3__ring" aria-label="Наши бармены" ref={ringRef}>
              {members.map((m, i) => {
                const focus = focusFor(m.photoUrl);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`tm3__ava${i === idx ? ' tm3__ava--on' : ''}`}
                    style={{
                      '--i': i, // задержка волны появления слева направо
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

            {/* Низ секции: цитата слева, описание справа — на одной высоте,
                симметрично относительно центра (макет владельца). */}
            <div className="tm3__panels">
              <figure className="tm3__quote">
                <QuoteFrame />
                <blockquote className="tm3__quote-text">{QUOTE_STUB}</blockquote>
              </figure>

              <article className="tm3__about" key={current.id}>
                <QuoteFrame />
                <h2 className="tm3__name">{current.name}</h2>
                {current.role && <div className="tm3__role">{current.role}</div>}
                {current.spec && <div className="tm3__spec">{current.spec}</div>}
                {current.bio && <div className="tm3__rule" />}
                {current.bio && <p className="tm3__bio">{current.bio}</p>}
              </article>
            </div>

            {/* TODO(2026-08-27): временно скрыто по ТЗ владельца — вернуть
                после утверждения новой раскладки. Имя переехало внутрь блока
                описания, биография показывается целиком (без «читать дальше»),
                лента из трёх кадров и блок «стать бартендером» сняты с экрана,
                чтобы у секции остался один акцент. Данные в БД целы. */}
            {false && (
              <>
                <header className="tm3__head">
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
              </>
            )}
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
