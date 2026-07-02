import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: '#0C0A18', color: '#F2EDE4', fontFamily: "'Avenir Next', sans-serif", padding: '24px', textAlign: 'center',
      }}>
        <img src="/uploads/logo-icon.svg" alt="" style={{ height: 40, width: 'auto', opacity: 0.85, marginBottom: 28 }} />
        <h1 style={{ fontFamily: "'Baskerville', serif", fontSize: 24, margin: '0 0 10px' }}>
          Что-то пошло не так
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: 'rgba(242,237,228,0.6)', maxWidth: 380, margin: '0 0 32px' }}>
          Страница споткнулась о собственный коврик. Попробуйте обновить — обычно это помогает.
        </p>
        <button
          onClick={() => { this.setState({ error: null }); window.location.href = '/'; }}
          style={{
            display: 'inline-block', padding: '13px 28px', fontSize: 12, letterSpacing: 1.5,
            color: '#0C0A18', background: '#D4A843', border: 'none', cursor: 'pointer', fontWeight: 600,
          }}
        >
          ← НА ГЛАВНУЮ
        </button>
      </div>
    );
  }
}
