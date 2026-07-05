import { supabase } from './supabase.js';

function generateId() { return 'tm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

function rowToMember(r) {
  return {
    id: r.id,
    name: r.name,
    role: r.role || '',
    spec: r.spec || '',
    bio: r.bio || '',
    quote: r.quote || '',
    quoteSource: r.quote_source || '',
    photoUrl: r.photo_url || '',
    sortOrder: r.sort_order,
    active: r.active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getTeamMembers({ activeOnly = true } = {}) {
  let q = supabase.from('team_members').select('*').order('sort_order', { ascending: true });
  if (activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(rowToMember);
}

export async function createTeamMember(input) {
  if (!input.name?.trim()) throw new Error('Имя обязательно');
  const { data: maxRow } = await supabase
    .from('team_members').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const row = {
    id: generateId(),
    name: input.name.trim(),
    role: input.role?.trim() || '',
    spec: input.spec?.trim() || '',
    bio: input.bio?.trim() || '',
    quote: input.quote?.trim() || '',
    quote_source: input.quoteSource?.trim() || '',
    photo_url: input.photoUrl?.trim() || '',
    sort_order: nextOrder,
    active: input.active !== false,
  };
  const { data, error } = await supabase.from('team_members').insert(row).select().single();
  if (error) throw new Error(error.message);
  return rowToMember(data);
}

export async function updateTeamMember(id, input) {
  const patch = {};
  if ('name' in input)        patch.name         = input.name?.trim() || '';
  if ('role' in input)        patch.role         = input.role?.trim() || '';
  if ('spec' in input)        patch.spec         = input.spec?.trim() || '';
  if ('bio' in input)         patch.bio          = input.bio?.trim() || '';
  if ('quote' in input)       patch.quote        = input.quote?.trim() || '';
  if ('quoteSource' in input) patch.quote_source = input.quoteSource?.trim() || '';
  if ('photoUrl' in input)    patch.photo_url    = input.photoUrl?.trim() || '';
  if ('active' in input)      patch.active       = !!input.active;

  const { data, error } = await supabase.from('team_members').update(patch).eq('id', id).select().single();
  if (error) throw new Error('Участник не найден');
  return rowToMember(data);
}

export async function deleteTeamMember(id) {
  const { error } = await supabase.from('team_members').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Swap sort_order with the adjacent row (admin reordering, no-op at edges). */
export async function moveTeamMember(id, direction) {
  const all = await getTeamMembers({ activeOnly: false });
  const idx = all.findIndex(m => m.id === id);
  if (idx === -1) throw new Error('Участник не найден');
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= all.length) return all;

  const a = all[idx], b = all[swapIdx];
  await supabase.from('team_members').update({ sort_order: b.sortOrder }).eq('id', a.id);
  await supabase.from('team_members').update({ sort_order: a.sortOrder }).eq('id', b.id);
  return getTeamMembers({ activeOnly: false });
}
