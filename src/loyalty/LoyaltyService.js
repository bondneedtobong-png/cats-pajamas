import { apiFetch } from '../api.js';

/** Client-side loyalty API wrapper — mirrors the bot's api/_lib/loyalty.js logic. */
const LoyaltyService = {
  /** { status: {points, tier, next}, todaySpin: {...}|null } */
  async getStatus() {
    return apiFetch('/api/loyalty');
  },
  /** { prize, tier } — throws 'Колесо сегодня уже крутили…' if already spun today. */
  async spin() {
    return apiFetch('/api/loyalty', { method: 'POST', body: { action: 'spin' } });
  },
};

export default LoyaltyService;
