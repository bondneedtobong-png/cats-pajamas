import { supabase } from './supabase.js';

// grammY session storage adapter backed by the existing `app_config` jsonb
// key/value table (no new table needed). Used for short admin-only wizards
// (e.g. "add event") that need state to survive across serverless invocations —
// Vercel functions don't keep in-memory state reliably between updates.
const PREFIX = 'bot_session:';

export function supabaseSessionStorage() {
  return {
    async read(key) {
      const { data } = await supabase.from('app_config').select('value').eq('key', PREFIX + key).maybeSingle();
      return data?.value ?? undefined;
    },
    async write(key, value) {
      await supabase.from('app_config').upsert({ key: PREFIX + key, value });
    },
    async delete(key) {
      await supabase.from('app_config').delete().eq('key', PREFIX + key);
    },
  };
}
