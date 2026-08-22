import { apiFetch } from '../api.js';

/** Упоминания в изданиях — тот же канало-независимый паттерн, что у остальных сервисов. */
const PressService = {
  /** Публично — только active, свежие сверху. */
  async getPublic() {
    const d = await apiFetch('/api/press-mentions', { auth: false });
    return d.mentions;
  },
  /** Админ — включая скрытые. */
  async getAllAdmin() {
    const d = await apiFetch('/api/press-mentions?admin=1');
    return d.mentions;
  },
  async create(data) {
    const d = await apiFetch('/api/press-mentions', { method: 'POST', body: { action: 'create', data } });
    return d.mention;
  },
  async update(id, data) {
    const d = await apiFetch('/api/press-mentions', { method: 'POST', body: { action: 'update', id, data } });
    return d.mention;
  },
  async remove(id) {
    return apiFetch('/api/press-mentions', { method: 'POST', body: { action: 'delete', id } });
  },
};

export default PressService;
