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

  const paras = Array.isArray(tx.aboutText) ? tx.aboutText : [tx.aboutText];
  const [firstLetter, ...restOfFirst] = paras[0] ?? '';

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
        <div ref={r2} className="reveal about__quote-wrap">
          <span className="about__quote-mark" aria-hidden="true">&rdquo;</span>
          <blockquote className="about__quote">{tx.aboutQuote}</blockquote>
        </div>
        <div ref={r3} className="reveal about__text">
          <p className="about__para">
            <span className="about__dropcap">{firstLetter}</span>{restOfFirst.join('')}
          </p>
          {paras.slice(1).map((p, i) => (
            <p key={i} className="about__para">{p}</p>
          ))}
        </div>
      </div>
    </section>
  );
}
