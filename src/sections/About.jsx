import { useReveal } from '../useReveal.js';

const Ornament = ({ width = 48 }) => (
  <div className="ornament">
    <div className="ornament__line" style={{ width }} />
    <svg viewBox="0 0 16 16" width="8" height="8" fill="currentColor">
      <rect x="5" y="0" width="6" height="6" transform="rotate(45 8 8)"/>
    </svg>
    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
      <rect x="4" y="0" width="8" height="8" transform="rotate(45 8 8)"/>
    </svg>
    <svg viewBox="0 0 16 16" width="8" height="8" fill="currentColor">
      <rect x="5" y="0" width="6" height="6" transform="rotate(45 8 8)"/>
    </svg>
    <div className="ornament__line" style={{ width }} />
  </div>
);

export default function About({ tx }) {
  const r0 = useReveal(0);
  const r1 = useReveal(100);
  const r2 = useReveal(200);
  const r3 = useReveal(300);
  const r4 = useReveal(0);

  return (
    <section id="about" className="about">
      <div className="about__dots" />
      <div className="about__inner">
        <div ref={r0} className="reveal mb-18">
          <span className="sec-label">{tx.aboutLabel}</span>
        </div>
        <div ref={r1} className="reveal mb-50">
          <Ornament />
        </div>
        <blockquote ref={r2} className="reveal about__quote">{tx.aboutQuote}</blockquote>
        <div ref={r3} className="reveal about__text">
          {(Array.isArray(tx.aboutText) ? tx.aboutText : [tx.aboutText]).map((p, i) => (
            <p key={i} className="about__para">{p}</p>
          ))}
        </div>

        <div ref={r4} className="reveal about__stats">
          <div className="about__stat">
            <div className="about__stat-num">5+</div>
            <div className="about__stat-label">{tx.statsYears}</div>
          </div>
          <div className="about__divider" />
          <div className="about__stat">
            <div className="about__stat-num">12</div>
            <div className="about__stat-label">{tx.statsBartenders}</div>
          </div>
          <div className="about__divider" />
          <div className="about__stat">
            {/* TODO: реальные цифры от клиента */}
            <div className="about__stat-num">50+</div>
            <div className="about__stat-label">{tx.statsCocktails}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
