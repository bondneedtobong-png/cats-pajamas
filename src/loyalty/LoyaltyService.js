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

  /** Активные награды, с available/tierOk по текущему балансу+уровню гостя. */
  async getCatalog() {
    const d = await apiFetch('/api/loyalty?catalog=1');
    return d.catalog;
  },
  /** История начислений/списаний для вкладки «Уровень». */
  async getHistory() {
    const d = await apiFetch('/api/loyalty?history=1');
    return d.transactions;
  },
  /** { code, reward, expiresAt } — throws 'Недостаточно баллов'/'Нужен уровень...' */
  async redeem(rewardId) {
    return apiFetch('/api/loyalty', { method: 'POST', body: { action: 'redeem', rewardId } });
  },

  // ─── Admin ──────────────────────────────────────────────────────────────
  async getAllRewards() {
    const d = await apiFetch('/api/loyalty?admin_rewards=1');
    return d.rewards;
  },
  async createReward(data) {
    const d = await apiFetch('/api/loyalty', { method: 'POST', body: { action: 'create_reward', data } });
    return d.reward;
  },
  async updateReward(id, data) {
    const d = await apiFetch('/api/loyalty', { method: 'POST', body: { action: 'update_reward', id, data } });
    return d.reward;
  },
  async deleteReward(id) {
    return apiFetch('/api/loyalty', { method: 'POST', body: { action: 'delete_reward', id } });
  },
  async getRedemptions(status) {
    const d = await apiFetch(`/api/loyalty?admin_redemptions=1${status ? `&status=${status}` : ''}`);
    return d.redemptions;
  },
  /** Ручное погашение по коду из админки — фолбэк без Telegram. */
  async confirmRedemption(code) {
    return apiFetch('/api/loyalty', { method: 'POST', body: { action: 'confirm_redemption', code } });
  },
  async getRules() {
    const d = await apiFetch('/api/loyalty?admin_rules=1');
    return d.rules;
  },
  async setRules(rules) {
    return apiFetch('/api/loyalty', { method: 'POST', body: { action: 'set_rules', rules } });
  },
};

export default LoyaltyService;
