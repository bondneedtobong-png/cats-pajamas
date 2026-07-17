import { supabase } from './supabase.js';
import { deleteEventPhotos } from './eventPhotos.js';

// Server-side events logic, backed by Supabase.
// Real calendar dates (not weekday names) so "past events" filters naturally.
//
// Фото: events.image_urls (jsonb-массив путей) — основной источник (план v4 §B).
// Старое events.image_url (одна ссылка) не удалено ради обратной совместимости:
// при ЧТЕНИИ склеиваем (image_urls || [image_url]); при ЗАПИСИ заполняем оба
// (image_url = image_urls[0]). Так старые записи и старые формы не ломаются.

function generateId() { return 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

function todayIso() { return new Date().toISOString().split('T')[0]; }

// Нормализуем фото строки в массив: приоритет у image_urls, фолбэк на image_url.
function normalizePhotos(r) {
  const arr = Array.isArray(r.image_urls) ? r.image_urls.filter(u => typeof u === 'string' && u) : [];
  if (arr.length) return arr;
  return r.image_url ? [r.image_url] : [];
}

function rowToEvent(r) {
  const imageUrls = normalizePhotos(r);
  return {
    id: r.id,
    title: r.title,
    date: r.event_date,
    time: r.time || '',
    description: r.description || '',
    imageUrl: imageUrls[0] || '', // обратная совместимость: первое фото = обложка
    imageUrls,
    sortOrder: r.sort_order,
    active: r.active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    awardsPoints: !!r.awards_points,
    attendancePromptSentAt: r.attendance_prompt_sent_at || null,
  };
}

/** Входные фото → массив строк: поддержка нового imageUrls[] и старого imageUrl. */
function photosFromInput(input) {
  if (Array.isArray(input.imageUrls)) return input.imageUrls.filter(u => typeof u === 'string' && u.trim()).map(u => u.trim());
  if (typeof input.imageUrl === 'string') { const u = input.imageUrl.trim(); return u ? [u] : []; }
  return null; // поле не передано — не трогаем
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

export async function getEventById(id) {
  const { data, error } = await supabase.from('events').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToEvent(data) : null;
}

export async function createEvent(input) {
  if (!input.title?.trim()) throw new Error('Название обязательно');
  if (!input.date) throw new Error('Дата обязательна');

  const photos = photosFromInput(input) || [];
  const row = {
    id: input.id || generateId(), // явный id: мастер бота кладёт фото в папку до создания
    title: input.title.trim(),
    event_date: input.date,
    time: input.time?.trim() || '',
    description: input.description?.trim() || '',
    image_url: photos[0] || '',
    image_urls: photos,
    sort_order: 0,
    active: input.active !== false,
    awards_points: !!input.awardsPoints,
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
  if ('active' in input)      patch.active      = !!input.active;
  const photos = photosFromInput(input);
  if (photos) { patch.image_urls = photos; patch.image_url = photos[0] || ''; }

  const { data, error } = await supabase.from('events').update(patch).eq('id', id).select().single();
  if (error) throw new Error('Событие не найдено');
  return rowToEvent(data);
}

/** Заменить набор фото события (после загрузки/удаления). Возвращает событие. */
export async function setEventPhotos(id, urls) {
  const photos = (urls || []).filter(u => typeof u === 'string' && u.trim()).map(u => u.trim());
  const { data, error } = await supabase.from('events')
    .update({ image_urls: photos, image_url: photos[0] || '' }).eq('id', id).select().single();
  if (error) throw new Error('Событие не найдено');
  return rowToEvent(data);
}

export async function deleteEvent(id) {
  const { error } = await supabase.from('events').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await deleteEventPhotos(id); // best-effort уборка файлов события
}
