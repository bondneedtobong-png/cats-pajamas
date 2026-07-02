import { supabase } from './supabase.js';
import { notifyAdmins } from './telegramNotify.js';

function generateId() { return 'ap_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

function rowToApplication(r) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    experience: r.experience || '',
    status: r.status,
    createdAt: r.created_at,
  };
}

export async function getApplications() {
  const { data, error } = await supabase.from('team_applications').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(rowToApplication);
}

export async function createApplication(input) {
  if (!input.name?.trim())  throw new Error('Имя обязательно');
  if (!input.phone?.trim()) throw new Error('Телефон обязателен');

  const row = {
    id: generateId(),
    name: input.name.trim(),
    phone: input.phone.trim(),
    experience: input.experience?.trim() || '',
    status: 'new',
  };
  const { data, error } = await supabase.from('team_applications').insert(row).select().single();
  if (error) throw new Error(error.message);

  // Best-effort push — a Telegram hiccup must never fail the guest's submission.
  notifyAdmins(
    `🍸 *Новая заявка бармена!*\n\n` +
    `👤 ${row.name}\n📞 ${row.phone}\n` +
    (row.experience ? `💬 ${row.experience}\n` : '') +
    `\nОтветьте гостю напрямую.`
  ).catch(() => {});

  return rowToApplication(data);
}

export async function markReviewed(id) {
  const { data, error } = await supabase.from('team_applications').update({ status: 'reviewed' }).eq('id', id).select().single();
  if (error) throw new Error('Заявка не найдена');
  return rowToApplication(data);
}

export async function deleteApplication(id) {
  const { error } = await supabase.from('team_applications').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
