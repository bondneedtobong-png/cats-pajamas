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

export default function Hero({ tx }) {
  const [curtainDone, setCurtainDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setCurtainDone(true), 2100);
    return () => clearTimeout(t);
  }, []);

  return (
    <section id="hero" className="hero">
      {/* Background slideshow — CSS-only Ken Burns (zoom) + crossfade.
          TODO: заменить на финальные фото бара от клиента при наличии. */}
      <div className="hero__bg">
        <div className="hero__bg-slide hero__bg-slide--1" />
        <div className="hero__bg-slide hero__bg-slide--2" />
        <div className="hero__bg-slide hero__bg-slide--3" />
      </div>
      <div className="hero__vignette" />
      <div className="hero__grad" />
      <div className="hero__neon hero__neon--left" />
      <div className="hero__neon hero__neon--right" />

      {!curtainDone && (
        <div className="hero__curtain-wrap">
          <div className="hero__curtain-l" />
          <div className="hero__curtain-r" />
        </div>
      )}

      <div className="hero__content">
        <div style={{ marginBottom: 36 }}><Ornament /></div>

        <div className="hero__logo">
          <img
            src="/uploads/logo.svg"
            alt="The Cat's Pajamas Club"
            className="hero__logo-svg"
          />
        </div>

        <div style={{ marginBottom: 30 }}><Ornament /></div>

        <p className="hero__tagline">{tx.heroTagline}</p>
        <p className="hero__sub">{tx.heroSub}</p>
        <a href="/booking" className="hero__btn">{tx.heroCta}</a>
      </div>

      <div className="hero__scroll">
        <div className="hero__scroll-line" />
      </div>
    </section>
  );
}
