import { useState, useEffect } from 'react';
import { useOffscreenPause } from '../useReveal.js';
import { pageImages } from '../data.js';

const Ornament = ({ width = 72 }) => (
  <div className="ornament" style={{ marginBottom: 0 }}>
    <div className="ornament__line" style={{ width }} />
    <svg viewBox="0 0 16 16" width="9" height="9" fill="currentColor">
      <rect x="5" y="0" width="6" height="6" transform="rotate(45 8 8)"/>
    </svg>
    <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
      <rect x="4" y="0" width="8" height="8" transform="rotate(45 8 8)"/>
    </svg>
    <svg viewBox="0 0 16 16" width="9" height="9" fill="currentColor">
      <rect x="5" y="0" width="6" height="6" transform="rotate(45 8 8)"/>
    </svg>
    <div className="ornament__line" style={{ width }} />
  </div>
);

// Карточки-переходы на другие главы книги — оглавление прямо на первом
// экране (правка владельца 2026-07-08: переехали из «Легенды» сюда, в Hero).
// 5 карточек = все остальные главы (сама Hero — это «Главная», ей карточка
// не нужна): 3 слева (Легенда, Бармены, Напитки) поровну делят высоту,
// 2 справа (Афиша, Как найти) поровну — крупнее, но колонки одной суммарной
// высоты. Видны только на широком десктопе (>1200px) — см. .hero__side.
function SideCard({ id, image, label }) {
  return (
    <a href={`#${id}`} className="hero__card" aria-label={label}>
      <div className="hero__card-img" style={{ backgroundImage: `url(${image})` }} />
      <div className="hero__card-scrim" />
      <div className="hero__card-body">
        <span className="hero__card-rule" />
        <div className="hero__card-row">
          <span className="hero__card-label">{label}</span>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </a>
  );
}

export default function Hero({ tx }) {
  const [curtainDone, setCurtainDone] = useState(false);
  const offscreenRef = useOffscreenPause();

  useEffect(() => {
    const t = setTimeout(() => setCurtainDone(true), 2100);
    return () => clearTimeout(t);
  }, []);

  return (
    <section id="hero" className="hero" ref={offscreenRef}>
      {/* Background — bar photography treated as cover stock, not a photo
          hero: heavier vignette/desaturation so it reads as texture behind
          printed type rather than a snapshot. */}
      <div className="hero__bg">
        <div className="hero__bg-slide hero__bg-slide--1" />
        <div className="hero__bg-slide hero__bg-slide--2" />
        <div className="hero__bg-slide hero__bg-slide--3" />
      </div>
      {/* Медленно вращающееся свечение-лучи за логотипом (реф владельца).
          Только transform: rotate — дёшево; пауза вне hero (.is-offscreen,
          useOffscreenPause) + reduced-motion в CSS. */}
      <div className="hero__rays" aria-hidden="true" />
      <div className="hero__vignette" />
      <div className="hero__grad" />

      {!curtainDone && (
        <div className="hero__curtain-wrap">
          <div className="hero__curtain-l" />
          <div className="hero__curtain-r" />
        </div>
      )}

      <div className="hero__cols">
        <div className="hero__side hero__side--left">
          <SideCard id="about"    image={pageImages.about}    label={tx.navAbout} />
          <SideCard id="team"     image={pageImages.team}     label={tx.navTeam} />
          <SideCard id="menu"     image={pageImages.menu}     label={tx.navMenu} />
        </div>

        <div className="hero__content">
          <p className="hero__edition">{tx.heroEdition}</p>
          <div style={{ marginBottom: 14 }}><Ornament width={150} /></div>

          <div className="hero__logo">
            <img
              src="/uploads/logo.svg"
              alt="The Cat's Pajamas Club"
              className="hero__logo-svg"
            />
          </div>

          <div style={{ marginBottom: 14 }}><Ornament width={150} /></div>

          <p className="hero__tagline">{tx.heroTagline}</p>
          <p className="hero__sub">{tx.heroSub}</p>
          {/* Редизайн: бронь больше не встроена в лендинг — обычная ссылка на
              рабочий отдельный маршрут /booking (см. HANDOFF-историю). */}
          <a href="/booking" className="hero__btn">{tx.heroCta}</a>
        </div>

        <div className="hero__side hero__side--right">
          <SideCard id="events"   image={pageImages.events}   label={tx.navEvents} />
          <SideCard id="contacts" image={pageImages.contacts} label={tx.navContacts} />
        </div>
      </div>
    </section>
  );
}
