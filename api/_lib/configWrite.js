import { supabase } from './supabase.js';

export function configConflict() {
  return Object.assign(new Error('Настройки уже изменены. Обновите страницу перед сохранением.'), { status: 409 });
}

// Retry only when a different writer changed the blob. The patch callback owns
// conflict checks for its fields; unrelated fields are copied from each fresh read.
export async function patchConfig(key, patch) {
  let initial;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase.from('app_config').select('value,revision').eq('key', key).maybeSingle();
    if (error) throw new Error(error.message);
    const current = data?.value ?? {};
    if (initial === undefined) initial = structuredClone(current);
    const next = patch(structuredClone(current), initial);
    let result;
    if (!data) {
      result = await supabase.from('app_config').insert({ key, value: next }).select('key,revision').single();
      if (result.error?.code === '23505') continue;
    } else {
      let query = supabase.from('app_config').update({ value: next }).eq('key', key);
      if (!Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error('Версия настроек недоступна');
      query = query.eq('revision', data.revision);
      result = await query.select('key,revision').maybeSingle();
    }
    if (result.error) throw new Error(result.error.message);
    if (result.data) {
      if (!Number.isSafeInteger(result.data.revision) || result.data.revision < 0) throw new Error('Версия настроек недоступна');
      return next;
    }
  }
  throw configConflict();
}
