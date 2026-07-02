import { apiFetch } from '../api.js';

/** Client-side reviews API wrapper — same channel-agnostic pattern as the others. */
const ReviewsService = {
  /** Public — active + rating>=4 only, newest first. */
  async getPublic() {
    const d = await apiFetch('/api/reviews', { auth: false });
    return d.reviews;
  },
  /** Admin — everything, including low ratings / hidden. */
  async getAllAdmin() {
    const d = await apiFetch('/api/reviews?admin=1');
    return d.reviews;
  },
  async create(data) {
    const d = await apiFetch('/api/reviews', { method: 'POST', body: { action: 'create', data } });
    return d.review;
  },
  async update(id, data) {
    const d = await apiFetch('/api/reviews', { method: 'POST', body: { action: 'update', id, data } });
    return d.review;
  },
  async remove(id) {
    return apiFetch('/api/reviews', { method: 'POST', body: { action: 'delete', id } });
  },
};

export default ReviewsService;
