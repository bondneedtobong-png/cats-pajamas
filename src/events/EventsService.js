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
  /** Загрузка фото файлом (base64) → { url, thumbUrl }. eventId нужен заранее. */
  async uploadPhoto(eventId, imageBase64) {
    return apiFetch('/api/events', { method: 'POST', body: { action: 'upload_photo', eventId, imageBase64 } });
  },
  /** Удалить файл фото на сервере (best-effort). */
  async deletePhoto(eventId, url) {
    return apiFetch('/api/events', { method: 'POST', body: { action: 'delete_photo', eventId, url } });
  },
};

export default EventsService;
