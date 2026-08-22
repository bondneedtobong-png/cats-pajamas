// Витрина кандидатов для выбора владельцем: /lab.
//   /lab/hero/silk | aurora | prism   — WebGL-фон первого экрана
//   /lab/hover/glare | magnet | tilt  — единый язык hover'ов (§C.2)
// На лендинге ничего из этого не включено: страница лежит отдельным
// маршрутом, грузится лениво и никуда не залинкована. После выбора вариант
// переезжает в секции, остальные файлы удаляются.
import { lazy, Suspense } from 'react';
import { useParams, Link } from 'react-router-dom';
import { pageImages, translations } from '../data.js';
import { Glare, Magnet, Tilt } from './hovers.jsx';
import './lab.css';

const SilkBg = lazy(() => import('./SilkBg.jsx'));
const AuroraBg = lazy(() => import('./AuroraBg.jsx'));
const PrismBg = lazy(() => import('./PrismBg.jsx'));

const HERO = {
  silk: { Bg: SilkBg, title: 'Silk — текучий атлас' },
  aurora: { Bg: AuroraBg, title: 'Aurora — световой занавес' },
  prism: { Bg: PrismBg, title: 'Prism — луч сквозь призму' },
};

const HOVER = {
  glare: { Wrap: Glare, title: 'Glare — блик проезжает по элементу' },
  magnet: { Wrap: Magnet, title: 'Magnet — тянется к курсору' },
  tilt: { Wrap: Tilt, title: 'Tilt — доворачивается к курсору' },
};

function Bar({ kind, variant }) {
  const list = kind === 'hover' ? HOVER : HERO;
  return (
    <div className="lab__bar">
      <b>Витрина</b>
      <span>фон Hero:</span>
      {Object.keys(HERO).map((k) => (
        <Link key={k} to={`/lab/hero/${k}`} data-active={kind === 'hero' && variant === k ? '1' : '0'}>{k}</Link>
      ))}
      <span>hover:</span>
      {Object.keys(HOVER).map((k) => (
        <Link key={k} to={`/lab/hover/${k}`} data-active={kind === 'hover' && variant === k ? '1' : '0'}>{k}</Link>
      ))}
      <span style={{ marginLeft: 'auto' }}>{list[variant]?.title || ''}</span>
    </div>
  );
}

function HeroLab({ variant }) {
  const tx = translations.ru;
  const Bg = (HERO[variant] || HERO.silk).Bg;
  return (
    <section className="labhero">
      <Suspense fallback={null}><Bg /></Suspense>
      <div className="labhero__vignette" />
      <div className="labhero__grad" />
      <div className="labhero__content">
        <p className="labhero__edition">{tx.heroEdition}</p>
        <img src="/uploads/logo.svg" alt="The Cat's Pajamas Club" className="labhero__logo" />
        <p className="labhero__tagline">{tx.heroTagline}</p>
        <p className="labhero__sub">{tx.heroSub}</p>
        <a href="/booking" className="labhero__btn">{tx.heroCta}</a>
      </div>
      <p className="labhero__note">
        Шрифты и цвета — из логобука: Baskerville / Involve / Avenir Next, фон #1C101A, акцент #B08900
      </p>
    </section>
  );
}

const CARDS = [
  { img: pageImages.team, name: 'Бармены', role: 'Глава II' },
  { img: pageImages.menu, name: 'Меню', role: 'Глава III' },
  { img: pageImages.events, name: 'Афиша', role: 'Глава IV' },
];

function HoverLab({ variant }) {
  const { Wrap, title } = HOVER[variant] || HOVER.glare;
  return (
    <section className="labhover">
      <h1 className="labhover__title">{title}</h1>
      <p className="labhover__hint">Один язык на весь сайт: карточки, кнопки и ссылки ведут себя одинаково</p>

      <p className="labhover__label">Карточки разделов</p>
      <div className="labhover__row">
        {CARDS.map((c) => (
          <Wrap key={c.name}>
            <div className="labcard">
              <div className="labcard__img" style={{ backgroundImage: `url(${c.img})` }} />
              <div className="labcard__body">
                <p className="labcard__name">{c.name}</p>
                <p className="labcard__role">{c.role}</p>
              </div>
            </div>
          </Wrap>
        ))}
      </div>

      <p className="labhover__label">Кнопки</p>
      <div className="labhover__row">
        <Wrap><span className="labbtn">Забронировать стол</span></Wrap>
        <Wrap><span className="labbtn labbtn--ghost">Мой профиль</span></Wrap>
      </div>

      <p className="labhover__label">Ссылки навигации</p>
      <div className="labhover__row">
        {['Легенда', 'Бармены', 'Меню', 'Афиша'].map((t) => (
          <Wrap key={t}><span className="lablink">{t}</span></Wrap>
        ))}
      </div>
    </section>
  );
}

export default function LabPage() {
  const { kind = 'hero', variant = 'silk' } = useParams();
  return (
    <div className="lab" data-theme="A">
      <Bar kind={kind} variant={variant} />
      {kind === 'hover' ? <HoverLab variant={variant} /> : <HeroLab variant={variant} />}
    </div>
  );
}
