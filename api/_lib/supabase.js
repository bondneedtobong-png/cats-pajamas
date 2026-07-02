import { createClient } from '@supabase/supabase-js';

// Server-only Supabase client. Uses the SECRET key, so it bypasses RLS —
// must never be imported into client/browser code (only api/* functions).
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
