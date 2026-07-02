import { apiFetch } from '../api.js';

/** Client-side events API wrapper — same channel-agnostic pattern as CocktailsService. */
const EventsService = {
  /** Public — upcoming (today+) active events, ordered by date. */
  async getPublic() {
    const d = await apiFetch('/api/events', { auth: false });
    return d.events;
  },
  /** Admin — all events including past/inactive. */
  async getAllAdmin() {
    const d = await apiFetch('/api/events?admin=1');
    return d.events;
  },
  async create(data) {
    const d = await apiFetch('/api/events', { method: 'POST', body: { action: 'create', data } });
    return d.event;
  },
  async update(id, data) {
    const d = await apiFetch('/api/events', { method: 'POST', body: { action: 'update', id, data } });
    return d.event;
  },
  async remove(id) {
    return apiFetch('/api/events', { method: 'POST', body: { action: 'delete', id } });
  },
};

export default EventsService;
