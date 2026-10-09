import { apiFetch, setToken, getToken, notifyAuthChanged } from '../api.js';

const USER_KEY = 'cpjc_user';

function cacheUser(u) {
  if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
  else localStorage.removeItem(USER_KEY);
  notifyAuthChanged();
}

/**
 * Client-side auth. Real logic lives on the server (/api/auth); here we keep a
 * cached copy of the current user + a signed token in localStorage so the UI can
 * read identity synchronously. The server re-checks the token (and role) on every
 * request, so the cache is for display only.
 */
const AuthService = {
  /** Sync read of the cached user (UI convenience). */
  getCurrentUser() {
    if (!getToken()) return null;
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  },

  isAuthenticated() { return !!getToken() && !!AuthService.getCurrentUser(); },
  isAdmin() { return AuthService.getCurrentUser()?.role === 'admin'; },

  /** Server-controlled login modes; phone mock exists only in local demo. */
  async getLoginOptions() {
    return apiFetch('/api/auth', { method: 'POST', auth: false, body: { action: 'login_options' } });
  },

  /** Local demo phone code — no SMS is sent. */
  async requestOtp(phone) {
    const d = await apiFetch('/api/auth', { method: 'POST', auth: false, body: { action: 'request_otp', phone } });
    return d.devCode;
  },

  /** Local demo phone code — step 2. Opens a guest session. */
  async verifyOtp(phone, code) {
    const d = await apiFetch('/api/auth', { method: 'POST', auth: false, body: { action: 'verify_otp', phone, code } });
    setToken(d.token); cacheUser(d.user);
    return d.user;
  },

  /** Вход через Telegram-бота — шаг 1: получить токен + deep-link на бота. */
  async startTelegramLogin() {
    return apiFetch('/api/auth', { method: 'POST', auth: false, body: { action: 'start_telegram_login' } });
  },

  /** Шаг 2 (поллинг): проверить, подтвердил ли гость вход в боте.
   *  При status==='completed' сразу открывает сессию. */
  async checkTelegramLogin(token) {
    const d = await apiFetch('/api/auth', { method: 'POST', auth: false, body: { action: 'check_telegram_login', token } });
    if (d.status === 'completed') { setToken(d.token); cacheUser(d.user); }
    return d;
  },

  /** Вход изнутри Telegram Mini App — initData уже подписан ботом, HMAC проверяется на сервере. */
  async authViaTelegramWebApp(initData) {
    const d = await apiFetch('/api/auth', { method: 'POST', auth: false, body: { action: 'telegram_webapp', initData } });
    setToken(d.token); cacheUser(d.user);
    return d.user;
  },

  async updateProfile(updates) {
    const d = await apiFetch('/api/auth', { method: 'POST', body: { action: 'update_profile', name: updates.name } });
    cacheUser(d.user);
    return d.user;
  },

  /** Re-validate the cached user against the server (optional refresh). */
  async refresh() {
    if (!getToken()) { cacheUser(null); return null; }
    try {
      const d = await apiFetch('/api/auth', { method: 'POST', body: { action: 'me' } });
      if (!d.user) AuthService.logout();
      else cacheUser(d.user);
      return d.user || null;
    } catch { return null; }
  },

  logout() { setToken(null); cacheUser(null); },
};

export default AuthService;
