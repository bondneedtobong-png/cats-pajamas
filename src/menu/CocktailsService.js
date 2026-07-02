import { apiFetch } from '../api.js';

/**
 * Client-side menu API wrapper. Content lives in Supabase (shared by web +
 * admin), same channel-agnostic pattern as BookingService.
 */
const CocktailsService = {
  /** Public menu — active cocktails only, ordered. */
  async getPublic() {
    const d = await apiFetch('/api/cocktails', { auth: false });
    return d.cocktails;
  },
  /** Admin — all cocktails including inactive. */
  async getAllAdmin() {
    const d = await apiFetch('/api/cocktails?admin=1');
    return d.cocktails;
  },
  async create(data) {
    const d = await apiFetch('/api/cocktails', { method: 'POST', body: { action: 'create', data } });
    return d.cocktail;
  },
  async update(id, data) {
    const d = await apiFetch('/api/cocktails', { method: 'POST', body: { action: 'update', id, data } });
    return d.cocktail;
  },
  async remove(id) {
    return apiFetch('/api/cocktails', { method: 'POST', body: { action: 'delete', id } });
  },
  async move(id, direction) {
    const d = await apiFetch('/api/cocktails', { method: 'POST', body: { action: 'move', id, direction } });
    return d.cocktails;
  },
};

export default CocktailsService;
