import { Link } from 'react-router-dom';

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#0C0A18', color: '#F2EDE4', fontFamily: "'Avenir Next', sans-serif", padding: '40px 24px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <Link to="/" style={{ fontSize: 11, color: 'rgba(212,168,67,0.65)', textDecoration: 'none', letterSpacing: 1 }}>
          ← На главную
        </Link>

        <h1 style={{ fontFamily: "'Baskerville', serif", fontSize: 28, marginTop: 28, marginBottom: 8 }}>
          Политика конфиденциальности
        </h1>
        <p style={{ fontSize: 12, color: 'rgba(212,168,67,0.45)', marginBottom: 32 }}>
          Cat's Pajamas Club · Самара
        </p>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 11, letterSpacing: 2, color: '#D4A843', marginBottom: 14 }}>КАКИЕ ДАННЫЕ МЫ СОБИРАЕМ</h2>
          <p style={{ fontSize: 14, lineHeight: 1.8, color: 'rgba(242,237,228,0.65)' }}>
            При бронировании стола, входе через телефон/Telegram или отправке заявки мы получаем имя, номер телефона
            и другие данные, которые вы указываете добровольно. Полный текст политики размещается здесь после
            юридической проверки владельцем заведения.
          </p>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 11, letterSpacing: 2, color: '#D4A843', marginBottom: 14 }}>ФАЙЛЫ COOKIE</h2>
          <p style={{ fontSize: 14, lineHeight: 1.8, color: 'rgba(242,237,228,0.65)' }}>
            Сайт использует cookie-файлы для аналитики посещаемости — только после вашего согласия в баннере внизу
            экрана. Вы можете изменить своё решение в любой момент, очистив данные сайта в браузере.
          </p>
        </section>

        <div style={{ fontSize: 11, color: 'rgba(242,237,228,0.25)', padding: '12px 14px', border: '1px solid rgba(212,168,67,0.1)', lineHeight: 1.6 }}>
          Документ является шаблоном для портфолио-проекта и не имеет юридической силы,
          пока не будет проверен и утверждён владельцем заведения.
        </div>
      </div>
    </div>
  );
}
