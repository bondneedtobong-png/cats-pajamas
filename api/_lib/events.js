import { supabase } from './supabase.js';

// Server-side events logic, backed by Supabase.
// Real calendar dates (not weekday names) so "past events" filters naturally.

function generateId() { return 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

function todayIso() { return new Date().toISOString().split('T')[0]; }

function rowToEvent(r) {
  return {
    id: r.id,
    title: r.title,
    date: r.event_date,
    time: r.time || '',
    description: r.description || '',
    imageUrl: r.image_url || '',
    sortOrder: r.sort_order,
    active: r.active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Public: upcoming (today or later) + active, ordered by date. Admin: everything, newest first. */
export async function getEvents({ upcomingOnly = true } = {}) {
  let q = supabase.from('events').select('*');
  if (upcomingOnly) {
    q = q.eq('active', true).gte('event_date', todayIso())
      .order('event_date', { ascending: true }).order('sort_order', { ascending: true });
  } else {
    q = q.order('event_date', { ascending: false }).order('sort_order', { ascending: true });
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(rowToEvent);
}

export async function createEvent(input) {
  if (!input.title?.trim()) throw new Error('Название обязательно');
  if (!input.date) throw new Error('Дата обязательна');

  const row = {
    id: generateId(),
    title: input.title.trim(),
    event_date: input.date,
    time: input.time?.trim() || '',
    description: input.description?.trim() || '',
    image_url: input.imageUrl?.trim() || '',
    sort_order: 0,
    active: input.active !== false,
  };
  const { data, error } = await supabase.from('events').insert(row).select().single();
  if (error) throw new Error(error.message);
  return rowToEvent(data);
}

export async function updateEvent(id, input) {
  const patch = {};
  if ('title' in input)       patch.title       = input.title?.trim() || '';
  if ('date' in input)        patch.event_date  = input.date;
  if ('time' in input)        patch.time        = input.time?.trim() || '';
  if ('description' in input) patch.description = input.description?.trim() || '';
  if ('imageUrl' in input)    patch.image_url   = input.imageUrl?.trim() || '';
  if ('active' in input)      patch.active      = !!input.active;

  const { data, error } = await supabase.from('events').update(patch).eq('id', id).select().single();
  if (error) throw new Error('Событие не найдено');
  return rowToEvent(data);
}

export async function deleteEvent(id) {
  const { error } = await supabase.from('events').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
