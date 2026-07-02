import { useReveal } from '../useReveal.js';

export default function Booking({ tx }) {
  const r0 = useReveal(0);
  const r1 = useReveal(100);
  const r2 = useReveal(200);
  const r3 = useReveal(300);

  return (
    <section id="booking" className="booking">
      <div className="booking__inner">
        <div ref={r0} className="reveal mb-10">
          <span className="sec-label">{tx.bookingLabel}</span>
        </div>
        <h2 ref={r1} className="reveal booking__title">{tx.bookingTitle}</h2>
        <p ref={r2} className="reveal booking__lead">{tx.depositNote}</p>
        <a ref={r3} href="/booking" className="reveal booking__cta">{tx.heroCta}</a>
      </div>
    </section>
  );
}
