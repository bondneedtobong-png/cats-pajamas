import { apiFetch } from '../api.js';

/** Уровень гостя (вкладка «Уровень» в ЛК). Баллы/колесо/каталог наград
 *  выведены из продукта 2026-07-04 — остался только вычисляемый уровень. */
const LoyaltyService = {
  /** { status: { level: {num,label,emoji}, bookings, next: {…, remaining}|null } } */
  async getStatus() {
    return apiFetch('/api/loyalty');
  },
};

export default LoyaltyService;
