import { apiFetch } from '../api.js';

/** "Join the team" applications — public submit, admin-managed inbox. */
const ApplicationsService = {
  async submit(data) {
    const d = await apiFetch('/api/applications', { method: 'POST', auth: false, body: { action: 'submit', data } });
    return d.application;
  },
  async getAllAdmin() {
    const d = await apiFetch('/api/applications');
    return d.applications;
  },
  async markReviewed(id) {
    const d = await apiFetch('/api/applications', { method: 'POST', body: { action: 'mark_reviewed', id } });
    return d.application;
  },
  async remove(id) {
    return apiFetch('/api/applications', { method: 'POST', body: { action: 'delete', id } });
  },
};

export default ApplicationsService;
