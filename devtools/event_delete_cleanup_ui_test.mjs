import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/admin/AdminPage.jsx', import.meta.url), 'utf8');
const start = source.indexOf('function TabEvents() {');
const end = source.indexOf('  const today = todayIso();', start);
assert.ok(start >= 0 && end > start);
const callbacks = new Function('useState', 'useRef', 'useEffect', 'EventsService',
  source.slice(start, end).split('\n').slice(1).join('\n') +
  '\nreturn { events, confirm, cleanupWarnings, retryingCleanup, handleDelete, retryDeletedPhotoCleanup };');
let slots = [], cursor = 0, view, calls = [], reply = { cleanupPending: true, warning: 'Событие удалено, но очистка фото не завершена' };
let wait;
function state(initial) {
  const i = cursor++;
  if (!(i in slots)) slots[i] = initial;
  return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
}
function ref(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }
const service = {
  async remove(id) { calls.push(id); if (wait) await wait; if (reply instanceof Error) throw reply; return reply; },
  create() { throw new Error('must never recreate deleted event'); }, update() { throw new Error('must never resave deleted event'); },
};
function render() { cursor = 0; view = callbacks(state, ref, () => {}, service); }
render();
const event = { id: 'ev_deleted', title: 'Test' };
view.handleDelete(event); render(); await view.confirm.onConfirm(); render();
assert.equal(view.confirm, null); assert.equal(view.cleanupWarnings[0].id, event.id);
assert.deepEqual(calls, [event.id]);
console.log('PASS successful DB deletion closes confirm and exposes cleanup warning');
reply = new Error('read failed'); await view.retryDeletedPhotoCleanup(event.id); render();
assert.match(view.cleanupWarnings[0].message, /Событие уже удалено.*read failed/);
console.log('PASS failed cleanup retry preserves warning and deleted state');
let resolve; wait = new Promise(r => { resolve = r; }); reply = { cleanupPending: false };
const retry = view.retryDeletedPhotoCleanup(event.id); render();
assert.deepEqual(view.retryingCleanup, [event.id]);
await view.retryDeletedPhotoCleanup(event.id);
assert.equal(calls.length, 3);
resolve(); await retry; render();
assert.deepEqual(view.cleanupWarnings, []); assert.deepEqual(view.retryingCleanup, []);
assert.deepEqual(calls, [event.id, event.id, event.id]);
console.log('PASS cleanup retry uses deleted id once, prevents double click and clears warning');
