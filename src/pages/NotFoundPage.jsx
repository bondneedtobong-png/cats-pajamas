import { Link } from 'react-router-dom';
import { usePageMeta } from '../usePageMeta.js';

export default function NotFoundPage() {
  usePageMeta({ title: "Страница не найдена — The Cat's Pajamas Club", noindex: true });
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: '#0C0A18', color: '#F2EDE4', fontFamily: "'Avenir Next', sans-serif", padding: '24px', textAlign: 'center',
    }}>
      <img src="/uploads/logo-icon.svg" alt="" style={{ height: 40, width: 'auto', opacity: 0.85, marginBottom: 28 }} />
      <div style={{ fontFamily: "'Baskerville', serif", fontSize: 84, lineHeight: 1, color: '#D4A843', opacity: 0.85 }}>404</div>
      <h1 style={{ fontFamily: "'Baskerville', serif", fontSize: 24, margin: '18px 0 10px' }}>
        Этот столик не найден
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.7, color: 'rgba(242,237,228,0.6)', maxWidth: 380, margin: '0 0 32px' }}>
        Похоже, вы заглянули туда, где джаз ещё не звучит. Такой страницы нет — но бар точно есть.
      </p>
      <Link
        to="/"
        style={{
          display: 'inline-block', padding: '13px 28px', fontSize: 12, letterSpacing: 1.5,
          color: '#0C0A18', background: '#D4A843', textDecoration: 'none', fontWeight: 600,
        }}
      >
        ← НА ГЛАВНУЮ
      </Link>
    </div>
  );
}
