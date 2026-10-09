// Static install contract. Live behavior is verified by the isolated SQL tests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261010_booking_occupancy_transaction.sql', import.meta.url), 'utf8');
const definition = sql => {
  const start = sql.indexOf('create or replace function public.sync_reservation_occupancy()');
  const endMarker = 'on public.reservations for each row execute function public.sync_reservation_occupancy();';
  const end = sql.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'atomic occupancy function and attached reservation trigger required');
  return sql.slice(start, end + endMarker.length).replace(/\s+/g, ' ').trim();
};
assert.equal(definition(schema), definition(migration), 'fresh install and targeted migration must install identical trigger contract');
assert.throws(() => definition(schema.replace('create or replace function public.sync_reservation_occupancy()', '-- missing function')));
assert.throws(() => definition(schema.replace('on public.reservations for each row execute function public.sync_reservation_occupancy();', '-- missing trigger')));
console.log('PASS CR06 static fresh-install/migration trigger contract and missing-definition controls');
