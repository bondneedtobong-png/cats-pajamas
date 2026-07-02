import { supabase } from './supabase.js';

// Server-side cocktail menu logic, backed by Supabase.
// Content is Russian-only by design (owner's decision) — the site's RU/EN
// toggle doesn't affect this table. Images are plain URLs (no Storage).

function generateId() { return 'ck_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

function rowToCocktail(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    ingredients: r.ingredients || '',
    story: r.story || '',
    taste: r.taste || '',
    price: r.price || '',
    imageUrl: r.image_url || '',
    sortOrder: r.sort_order,
    active: r.active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getCocktails({ activeOnly = true } = {}) {
  let q = supabase.from('cocktails').select('*').order('sort_order', { ascending: true });
  if (activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(rowToCocktail);
}

export async function createCocktail(input) {
  const { data: maxRow } = await supabase
    .from('cocktails').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  if (!input.name?.trim()) throw new Error('Название обязательно');

  const row = {
    id: generateId(),
    name: input.name.trim(),
    category: input.category === 'signature' ? 'signature' : 'classics',
    ingredients: input.ingredients?.trim() || '',
    story: input.story?.trim() || '',
    taste: input.taste?.trim() || '',
    price: input.price?.trim() || '',
    image_url: input.imageUrl?.trim() || '',
    sort_order: nextOrder,
    active: input.active !== false,
  };
  const { data, error } = await supabase.from('cocktails').insert(row).select().single();
  if (error) throw new Error(error.message);
  return rowToCocktail(data);
}

export async function updateCocktail(id, input) {
  const patch = {};
  if ('name' in input)        patch.name        = input.name?.trim() || '';
  if ('category' in input)    patch.category    = input.category === 'signature' ? 'signature' : 'classics';
  if ('ingredients' in input) patch.ingredients = input.ingredients?.trim() || '';
  if ('story' in input)       patch.story       = input.story?.trim() || '';
  if ('taste' in input)       patch.taste       = input.taste?.trim() || '';
  if ('price' in input)       patch.price       = input.price?.trim() || '';
  if ('imageUrl' in input)    patch.image_url   = input.imageUrl?.trim() || '';
  if ('active' in input)      patch.active      = !!input.active;

  const { data, error } = await supabase.from('cocktails').update(patch).eq('id', id).select().single();
  if (error) throw new Error('Коктейль не найден');
  return rowToCocktail(data);
}

export async function deleteCocktail(id) {
  const { error } = await supabase.from('cocktails').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Swap sort_order with the adjacent row (admin reordering, no-op at edges). */
export async function moveCocktail(id, direction) {
  const all = await getCocktails({ activeOnly: false });
  const idx = all.findIndex(c => c.id === id);
  if (idx === -1) throw new Error('Коктейль не найден');
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= all.length) return all;

  const a = all[idx], b = all[swapIdx];
  await supabase.from('cocktails').update({ sort_order: b.sortOrder }).eq('id', a.id);
  await supabase.from('cocktails').update({ sort_order: a.sortOrder }).eq('id', b.id);
  return getCocktails({ activeOnly: false });
}
