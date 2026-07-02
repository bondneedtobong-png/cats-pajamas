import { apiFetch } from '../api.js';

/** Client-side team API wrapper — same channel-agnostic pattern as the others. */
const TeamService = {
  async getPublic() {
    const d = await apiFetch('/api/team', { auth: false });
    return d.members;
  },
  async getAllAdmin() {
    const d = await apiFetch('/api/team?admin=1');
    return d.members;
  },
  async create(data) {
    const d = await apiFetch('/api/team', { method: 'POST', body: { action: 'create', data } });
    return d.member;
  },
  async update(id, data) {
    const d = await apiFetch('/api/team', { method: 'POST', body: { action: 'update', id, data } });
    return d.member;
  },
  async remove(id) {
    return apiFetch('/api/team', { method: 'POST', body: { action: 'delete', id } });
  },
  async move(id, direction) {
    const d = await apiFetch('/api/team', { method: 'POST', body: { action: 'move', id, direction } });
    return d.members;
  },
};

export default TeamService;
