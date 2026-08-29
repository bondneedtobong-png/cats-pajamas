import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useReveal, useOffscreenPause } from '../useReveal.js';
import QuoteFrame from '../ui/QuoteFrame.jsx';
import TeamService from '../team/TeamService.js';
import ApplicationsService from '../team/ApplicationsService.js';

// Секция «Бармены» v5 (приоритеты владельца, 2026-08-27). Порядок важности
// задан явно и определяет, кому достаётся высота экрана:
//   1) ТРИ КАДРА выбранного бармена (за стойкой · портрет · вне смены) —
//      главный акцент, забирают весь остаток высоты (у .tm3__shots flex: 1);
//   2) ряд аватарок сверху — это НАВИГАЦИЯ: крупный, но не главный размер
//      (до 210px, зазор — 0.22 диаметра) и плавная дуга, приподнятая к центру;
//   3) цитата и описание — компактные латунные плашки в том, что осталось.
//
// Две ошибки предыдущих заходов, чтобы не повторять: в v3 у ряда был хаотичный
// зигзаг по модулю индекса — его убрали, но вместе с ним по ошибке убрали и
// саму дугу; в v4 ряд раздули во всю ширину до 420px, а ленту кадров временно
// сняли с экрана — из-за этого главный элемент секции пропал. Возвращено.
//
// В `{false && (…)}` остаются только по-настоящему второстепенные блоки: метка
// главы, отдельный крупный заголовок с именем (имя живёт в плашке описания) и
// «стать бартендером». Данные и админка «КОМАНДА» не тронуты.
//
// Тексты цитат владелец переписывает заново — до этого во всех карточках стоит
// одна заглушка (QUOTE_STUB), цитаты из БД временно не показываются. Когда
// новые тексты появятся, убрать QUOTE_STUB и вернуть current.quote.
const QUOTE_STUB = 'Упс! Извините, текст временно украли, вернем его чуть позже!';

/**
 * Дуга ряда аватарок: гладкая парабола, приподнятая к центру (как бровь).
 * curve = 1 в середине ряда и 0 по краям; в CSS он умножается на --tm3-peak.
 * Считается от позиции ОТНОСИТЕЛЬНО ЦЕНТРА, поэтому остаётся симметричной при
 * любом числе барменов. Прежний зигзаг `((i % 4) - 1.5)` не зависел ни от
 * позиции в ряду, ни от их количества — потому и выглядел хаосом.
 */
function arcCurve(i, n) {
  const mid = (n - 1) / 2;
  if (mid === 0) return 1;
  const t = (i - mid) / mid; // -1 … 0 … 1
  return 1 - t * t;
}

/**
 * Размер аватарки под ширину ряда. Ряд обязан помещаться в ОДНУ строку при
 * любом числе барменов: список тянется из админки и будет расти. Значит,
 * диаметр и зазор считаются от реальной ширины контейнера, а чистым CSS это не
 * выразить — отсюда замер в JS.
 * Потолок держим ниже v4 (там было 420px, и аватарки съели место у трёх кадров),
 * но заметно выше v5: 150px при зазоре в полторы сотни пикселей читались как
 * мелкие точки в пустоте.
 */
const AVA_MIN = 68;    // мельче — уже не лица, а точки
const AVA_MAX = 210;   // потолок диаметра на широком экране
const AVA_VH  = 0.24;  // потолок по высоте: на низком экране ряд обязан ужаться
const GAP_MIN = 10;
/**
 * Зазор задан ДОЛЕЙ ДИАМЕТРА, а не остатком ширины (правка 2026-08-29).
 * Раньше свободная ширина целиком уходила в зазоры, и при семи барменах ряд
 * выглядел как мелкие кружки, расставленные через сто с лишним пикселей —
 * пустоты между лицами было больше, чем самих лиц. Теперь наоборот: сначала
 * из ширины считается максимальный диаметр при таком зазоре, и уже он даёт
 * реальный отступ. Ряд получается плотным и центрируется по секции.
 */
const GAP_K = 0.22;
const RING_MOBILE_MAX = 900; // ниже — лента с прокруткой, диаметр из CSS

/**
 * Параметры парения кружка (правка 2026-08-29). Ряд, качающийся синхронно,
 * читается как одна пружина, поэтому у каждой аватарки своя фаза, своя
 * длительность и своя амплитуда — движение выходит «вразнобой».
 *
 * Генератор детерминированный (только от индекса): значения не должны меняться
 * между рендерами, иначе анимация перезапускалась бы на каждый клик по ряду.
 * Задержка стартует после появления ряда волной (0.5s анимации + i*60ms её
 * задержки) — иначе парение перебило бы появление: обе анимации на transform,
 * и вторая в списке всегда выигрывает.
 */
const hash01 = (n) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); };
function floatVars(i) {
  return {
    '--float-dur':   (3 + hash01(i * 12.9898 + 1) * 1).toFixed(2) + 's',   // 3–4 c
    '--float-amp':   (6 + hash01(i * 78.233 + 2) * 4).toFixed(1) + 'px',   // 6–10 px
    '--float-delay': (0.5 + i * 0.06 + hash01(i * 39.425 + 3) * 2.4).toFixed(2) + 's',
  };
}

function fitRing(el, count) {
  const width = el.clientWidth;
  if (!width || !count) return;
  if (window.innerWidth <= RING_MOBILE_MAX) {
    el.style.removeProperty('--tm3-ava');
    el.style.removeProperty('--tm3-gap');
    return;
  }
  // Диаметр: потолки + «сколько влезет в строку, если между кружками ровно
  // GAP_K диаметра». Ряд обязан остаться в ОДНУ строку при любом составе.
  let d = Math.min(
    AVA_MAX,
    window.innerHeight * AVA_VH,
    width / (count + GAP_K * (count - 1)),
  );
  d = Math.max(AVA_MIN, d);
  if (d * count + GAP_MIN * (count - 1) > width) d = (width - GAP_MIN * (count - 1)) / count;

  // Зазор — доля диаметра, а не весь остаток ширины: лица рядом, а не россыпью
  // по секции. Второй предел нужен только на узком контейнере, где диаметр
  // упёрся в AVA_MIN и на полный зазор места уже нет.
  const gap = count > 1
    ? Math.max(GAP_MIN, Math.min(d * GAP_K, (width - d * count) / (count - 1)))
    : 0;

  el.style.setProperty('--tm3-ava', Math.floor(d) + 'px');
  el.style.setProperty('--tm3-gap', Math.round(gap) + 'px');
}

/**
 * Кого показываем при открытии секции. Первый экран — витрина трёх кадров,
 * поэтому по умолчанию берём первого бармена, у которого есть все три фото:
 * иначе гость видит один портрет и две рамки «Снимок скоро» (сейчас так у
 * Шамусара — оба кадра ещё не сняты). Правило самоочищается: как только
 * недостающие фото появятся в админке, снова победит первый по порядку.
 */
function pickInitial(list) {
  const full = list.findIndex(m => m.photoUrl && m.photoWorkUrl && m.photoFunUrl);
  return full === -1 ? 0 : full;
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

/**
 * Кадр ленты: фото или заглушка «снимок скоро».
 * Подписей под кадрами нет — владелец убрал их 2026-08-27 («ЗА СТОЙКОЙ» и
 * прочее): фотографии говорят сами за себя. Тексты tx.teamShot* остались в
 * src/data.js на случай возврата.
 */
function Shot({ url, kind, alt, soon }) {
  return (
    <figure className={`tm3__shot tm3__shot--${kind}${url ? '' : ' tm3__shot--empty'}`}>
      {url
        ? <img src={url} alt={alt} decoding="async" />
        : <span className="tm3__shot-stub"><CoupeSign /><span className="tm3__shot-soon">{soon}</span></span>}
    </figure>
  );
}

/**
 * Тройка кадров одного бармена. В DOM висят тройки ВСЕХ барменов, неактивные —
 * `display: none` (класс без --on).
 *
 * Так лечится задержка при переключении (жалоба владельца 2026-08-27: «нажал
 * на Егора, а сбоку ещё секунду фотки Лели»). Причина была не в React, а в
 * сети: nginx отдаёт /uploads с `no-cache, must-revalidate`, поэтому каждая
 * смена src дёргала сервер за 304, и браузер держал на экране старую картинку,
 * пока не приедет ответ. Предзагрузка через `new Image()` не спасала — она
 * греет кэш, но не отменяет ревалидацию.
 * Теперь все кадры загружаются один раз при монтировании секции, а
 * переключение — смена CSS-класса: ноль запросов, ноль ожидания.
 * `display: none` (а не visibility) выбран намеренно: скрытые кадры не держат
 * декодированные битмапы в памяти — при семи барменах это была бы сотня
 * мегабайт на слабой машине.
 */
function ShotsGroup({ member, active, soon }) {
  return (
    <div className={`tm3__shots${active ? ' tm3__shots--on' : ''}`} aria-hidden={!active}>
      <Shot kind="work" url={member.photoWorkUrl} soon={soon} alt={`${member.name} за работой`} />
      <Shot kind="hero" url={member.photoUrl} soon={soon} alt={member.name} />
      <Shot kind="fun" url={member.photoFunUrl} soon={soon} alt={`${member.name}, кадр вне смены`} />
    </div>
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
  // Парение аватарок бесконечное, поэтому секция обязана вставать на паузу вне
  // экрана (правило проекта: `is-offscreen`, см. useReveal.js).
  const sectionRef = useOffscreenPause();

  useEffect(() => {
    let alive = true;
    TeamService.getPublic()
      .then(list => { if (alive) { setMembers(list); setIdx(pickInitial(list)); } })
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
    <section id="team" className="team" ref={sectionRef}>
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
                      // Подъём по дуге: CSS умножает --tm3-peak на этот множитель.
                      '--curve': arcCurve(i, members.length).toFixed(4),
                      '--i': i, // задержка волны появления слева направо
                      ...floatVars(i), // фаза/длительность/амплитуда парения
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

            {/* Три кадра — главный акцент секции (приоритет №1 у владельца):
                «за стойкой» слева, парадный портрет по центру, «вне смены»
                справа. Блок забирает всю высоту, не занятую остальным.
                У кого фото ещё нет — слот со знаком-креманкой и «Снимок скоро»
                (сейчас так у Шамусара оба кадра, у Александра и Дениса — «вне
                смены»; появятся в админке — подхватятся сами). */}
            <div className="tm3__stage">
              {members.map((m, i) => (
                <ShotsGroup key={m.id} member={m} active={i === idx} soon={tx.teamShotSoon} />
              ))}
            </div>

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
                после утверждения раскладки. Имя переехало внутрь плашки
                описания, биография там же режется по строкам (без «читать
                дальше»), «стать бартендером» снят, чтобы не отбирать высоту у
                трёх кадров. Данные в БД целы. */}
            {false && (
              <>
                <header className="tm3__head">
                  <h2 className="tm3__name">{current.name}</h2>
                  {current.role && <div className="tm3__role">{current.role}</div>}
                  {current.spec && <div className="tm3__spec">{current.spec}</div>}
                </header>

                {current.bio && bioLong && (
                  <button type="button" className="tm3__bio-more" onClick={() => setBioOpen((v) => !v)}>
                    {bioOpen ? 'Свернуть' : 'Читать дальше'}
                  </button>
                )}

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
