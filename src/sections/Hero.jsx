import { useState, useEffect } from 'react';

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

// Small corner flourish — the printed-cover detail on a real menu booklet.
const CornerMark = ({ className }) => (
  <svg className={className} viewBox="0 0 40 40" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.4">
    <path d="M2 16V4a2 2 0 0 1 2-2h12" />
    <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

export default function Hero({ tx, onNext, onBooking }) {
  const [curtainDone, setCurtainDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setCurtainDone(true), 2100);
    return () => clearTimeout(t);
  }, []);

  return (
    <section id="hero" className="hero">
      {/* Background — bar photography treated as cover stock, not a photo
          hero: heavier vignette/desaturation so it reads as texture behind
          printed type rather than a snapshot. */}
      <div className="hero__bg">
        <div className="hero__bg-slide hero__bg-slide--1" />
        <div className="hero__bg-slide hero__bg-slide--2" />
        <div className="hero__bg-slide hero__bg-slide--3" />
      </div>
      {/* Медленно вращающееся свечение-лучи за логотипом (реф владельца).
          Только transform: rotate — дёшево; пауза вне hero + reduced-motion в CSS. */}
      <div className="hero__rays" aria-hidden="true" />
      <div className="hero__vignette" />
      <div className="hero__grad" />
      {/* Театральные шторки по краям сцены */}
      <div className="hero__drape hero__drape--left" aria-hidden="true" />
      <div className="hero__drape hero__drape--right" aria-hidden="true" />

      {!curtainDone && (
        <div className="hero__curtain-wrap">
          <div className="hero__curtain-l" />
          <div className="hero__curtain-r" />
        </div>
      )}

      {/* Cover frame — a double rule inset from the screen edge, like the
          board of a bound menu, with a corner mark in each corner. */}
      <div className="hero__frame" aria-hidden="true">
        <CornerMark className="hero__corner hero__corner--tl" />
        <CornerMark className="hero__corner hero__corner--tr" />
        <CornerMark className="hero__corner hero__corner--bl" />
        <CornerMark className="hero__corner hero__corner--br" />
      </div>

      <div className="hero__content">
        <p className="hero__edition">{tx.heroEdition}</p>
        <div style={{ marginBottom: 20 }}><Ornament /></div>

        <div className="hero__logo">
          <img
            src="/uploads/logo.svg"
            alt="The Cat's Pajamas Club"
            className="hero__logo-svg"
          />
        </div>

        <div style={{ marginBottom: 20 }}><Ornament /></div>

        <p className="hero__tagline">{tx.heroTagline}</p>
        <p className="hero__sub">{tx.heroSub}</p>
        {/* Бронь — страница книги на главной, а не /booking */}
        <button type="button" className="hero__btn" onClick={onBooking}>{tx.heroCta}</button>

        {/* In normal flow right after the CTA — a fixed/absolute overlay here
            would drift into the button whenever the flex-centered content
            above it runs long on a short viewport, so this stays anchored
            to the content instead of the screen edge. */}
        <button className="hero__next" onClick={onNext} aria-label={tx.heroNext}>
          <span>{tx.heroNext}</span>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </section>
  );
}
