import { apiFetch } from '../api.js';

/** Админский справочник гостей (вкладка ГОСТИ) — поверх /api/guests. */
const GuestsService = {
  /** Все зарегистрированные: имя, телефон, @username, уровень, брони, дата регистрации.
   *  Возвращает { guests, canManageRoles } — canManageRoles=true только у супер-админа (владельца из .env). */
  async list() {
    const d = await apiFetch('/api/guests');
    return { guests: d.guests || [], canManageRoles: !!d.canManageRoles };
  },
  /** Смена роли (только супер-админ): role = 'admin' | 'guest'. */
  async setRole(userId, role) {
    return apiFetch('/api/guests', { method: 'POST', body: { action: 'set_role', userId, role } });
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
