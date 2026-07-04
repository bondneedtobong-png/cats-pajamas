import { apiFetch } from '../api.js';

/** Админский справочник гостей (вкладка ГОСТИ) — поверх /api/guests. */
const GuestsService = {
  /** Все зарегистрированные: имя, телефон, @username, уровень, брони, дата регистрации. */
  async list() {
    const d = await apiFetch('/api/guests');
    return d.guests;
  },
  /** История броней гостя (свежие сверху). */
  async history(guestId) {
    const d = await apiFetch(`/api/guests?history=${encodeURIComponent(guestId)}`);
    return d.reservations;
  },
  /** Ручная правка уровня: level 1..9 или null — вернуть «авто». */
  async setLevel(userId, level) {
    return apiFetch('/api/guests', { method: 'POST', body: { action: 'set_level', userId, level } });
  },
};

export default GuestsService;
