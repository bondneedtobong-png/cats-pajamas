import { Link } from 'react-router-dom';
import { BOOKING_RULES } from '../booking/bookingRules.js';
import { usePageMeta } from '../usePageMeta.js';
import '../booking/booking.css';

export default function BookingRulesPage() {
  usePageMeta({
    title: "Правила бронирования — The Cat's Pajamas Club, Самара",
    description: 'Правила бронирования столов, депозит и условия отмены брони в джаз-баре «Пижама Кота» (The Cat\'s Pajamas Club), Самара.',
    canonical: 'https://cats-pajamas.ru/booking-rules',
  });
  return (
    <div style={{ minHeight: '100vh', background: '#0C0A18', color: '#F2EDE4', fontFamily: "'Avenir Next', sans-serif", padding: '40px 24px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <Link to="/booking" style={{ fontSize: 11, color: 'rgba(212,168,67,0.65)', textDecoration: 'none', letterSpacing: 1 }}>
          ← Вернуться к бронированию
        </Link>

        <h1 style={{ fontFamily: "'Baskerville', serif", fontSize: 28, marginTop: 28, marginBottom: 8 }}>
          Правила бронирования
        </h1>
        <p style={{ fontSize: 12, color: 'rgba(212,168,67,0.45)', marginBottom: 32 }}>
          Cat's Pajamas Club · Самара
        </p>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 11, letterSpacing: 2, color: '#D4A843', marginBottom: 14 }}>ДЕПОЗИТ И ОТМЕНА</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {BOOKING_RULES.shortSummary.map((rule, i) => (
              <li key={i} style={{ fontSize: 14, lineHeight: 1.7, color: 'rgba(242,237,228,0.75)', paddingLeft: 16, borderLeft: '2px solid rgba(212,168,67,0.2)' }}>
                {rule}
              </li>
            ))}
          </ul>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 11, letterSpacing: 2, color: '#D4A843', marginBottom: 14 }}>ПОРЯДОК БРОНИРОВАНИЯ</h2>
          <p style={{ fontSize: 14, lineHeight: 1.8, color: 'rgba(242,237,228,0.65)' }}>
            Полный текст правил и оферты размещается здесь после юридической проверки владельцем заведения.
            Для уточнения актуальных условий обратитесь к администратору.
          </p>
        </section>

        <div style={{ fontSize: 11, color: 'rgba(242,237,228,0.25)', padding: '12px 14px', border: '1px solid rgba(212,168,67,0.1)', lineHeight: 1.6 }}>
          {BOOKING_RULES.legalNote}
        </div>
      </div>
    </div>
  );
}
