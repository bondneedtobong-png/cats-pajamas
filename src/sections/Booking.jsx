import { useReveal } from '../useReveal.js';
import BookingWidget from '../booking/BookingWidget.jsx';

// Страница книги «Бронирование» — полноценная бронь на главной (план зала +
// дата/время прихода + панель стола + форма), а не CTA-заглушка на /booking.
// `active` гасит поллинг статусов, пока страница не открыта (все 8 страниц
// книги смонтированы одновременно).
export default function Booking({ tx, active }) {
  const r0 = useReveal(0);
  const r1 = useReveal(100);

  return (
    <section id="booking" className="booking booking--v2">
      <div className="booking__inner booking__inner--v2">
        <div ref={r0} className="reveal booking__head">
          <span className="sec-label">{tx.bookingLabel}</span>
          <h2 className="booking__title booking__title--v2">{tx.bookingTitle}</h2>
        </div>
        <div ref={r1} className="reveal booking__widget">
          <BookingWidget tx={tx} active={active} variant="book" />
        </div>
      </div>
    </section>
  );
}
