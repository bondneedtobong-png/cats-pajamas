import { supabase } from './supabase.js';

// Упоминания в СМИ — дословные выдержки из статей о баре на сторонних
// площадках со ссылкой на публикацию. Источник данных один: админка.
// Никакой автогенерации текста — цитата от лица реального издания, которого
// оно не писало, это подделка упоминания.

function generateId() { return 'pm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

function rowToMention(r) {
  return {
    id: r.id,
    excerpt: r.excerpt,
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    publishedAt: r.published_at,
    active: r.active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Ссылка уезжает на сайт в href — пускаем только http/https. Иначе в поле
// можно было бы сохранить javascript:… и получить исполняемый код по клику
// гостя (админка не равно доверенный ввод: доступ к ней есть у барменов).
function normalizeUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) throw new Error('Ссылка на публикацию обязательна');
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Ссылка должна быть полным адресом, например https://…'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Ссылка должна начинаться с http:// или https://');
  }
  return parsed.toString();
}

/** Публично — только active, свежие сверху. Админу — всё. */
export async function getPressMentions({ publicOnly = true } = {}) {
  let q = supabase.from('press_mentions').select('*').order('published_at', { ascending: false });
  if (publicOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(rowToMention);
}

export async function createPressMention(input) {
  if (!input.excerpt?.trim()) throw new Error('Цитата обязательна');
  if (!input.sourceName?.trim()) throw new Error('Название издания обязательно');

  const row = {
    id: generateId(),
    excerpt: input.excerpt.trim(),
    source_name: input.sourceName.trim(),
    source_url: normalizeUrl(input.sourceUrl),
    published_at: input.publishedAt || new Date().toISOString().split('T')[0],
    active: input.active !== false,
  };
  const { data, error } = await supabase.from('press_mentions').insert(row).select().single();
  if (error) throw new Error(error.message);
  return rowToMention(data);
}

export async function updatePressMention(id, input) {
  const patch = {};
  if ('excerpt' in input)     patch.excerpt      = input.excerpt?.trim() || '';
  if ('sourceName' in input)  patch.source_name  = input.sourceName?.trim() || '';
  if ('sourceUrl' in input)   patch.source_url   = normalizeUrl(input.sourceUrl);
  if ('publishedAt' in input) patch.published_at = input.publishedAt;
  if ('active' in input)      patch.active       = !!input.active;

  if (patch.excerpt === '') throw new Error('Цитата обязательна');
  if (patch.source_name === '') throw new Error('Название издания обязательно');

  const { data, error } = await supabase.from('press_mentions').update(patch).eq('id', id).select().single();
  if (error || !data) throw new Error('Упоминание не найдено');
  return rowToMention(data);
}

export async function deletePressMention(id) {
  const { error } = await supabase.from('press_mentions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
