// Real server functions with an in-memory PostgREST fixture. No network or env.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
globalThis.fetch = () => { throw new Error('Network forbidden'); };
async function load(file, dependencies, exports) {
  const source = (await readFile(new URL(file, import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  return new Function(...Object.keys(dependencies), `${source}\nreturn { ${exports} };`)(...Object.values(dependencies));
}
let revision = 0, value = null, failure = null, requests = [];
const clone = x => JSON.parse(JSON.stringify(x));
const fixture = {
  from(table) {
    let mode = 'read', patch, filters = {};
    const q = {
      select() { return q; }, order() { return q; }, eq(key, v) { filters[key] = v; return q; },
      update(v) { mode = 'update'; patch = v; return q; }, insert(v) { mode = 'insert'; patch = v; return q; },
      async maybeSingle() { return execute(); }, async single() { return execute(); },
      then(resolve, reject) { return Promise.resolve(table === 'app_config' ? execute() : { data: [{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }], error: null }).then(resolve, reject); },
    };
    function execute() {
      requests.push({ table, mode, filters });
      if (failure) return { error: { message: failure }, data: null };
      if (table !== 'app_config') return { data: null, error: null };
      if (mode === 'read') return { data: value === null ? null : { value: clone(value), revision }, error: null };
      if (mode === 'insert' && value !== null) return { error: { code: '23505' }, data: null };
      if (mode === 'update' && filters.revision !== revision) return { data: null, error: null };
      value = clone(patch.value);
      revision++;
      return { data: { key: 'bar_menu', revision }, error: null };
    }
    return q;
  },
};
const sample = label => ({ menu: [{ id: 'g', title: label, categories: [{ title: 'c', items: [{ name: 'Drink', price: '100' }] }] }], stories: { c: label } });
const { getBarMenu, setBarMenu } = await load('../api/_lib/barMenu.js', { supabase: fixture, BAR_MENU: sample('static').menu, CATEGORY_STORIES: {} }, 'getBarMenu, setBarMenu');
const a = await getBarMenu(), b = await getBarMenu();
assert.equal(a.configRevision, null);
const first = await setBarMenu(sample('first'), a.configRevision);
await assert.rejects(setBarMenu(sample('stale initial'), b.configRevision), e => e.status === 409);
assert.deepEqual(value, sample('first'));
const readers = await Promise.all([getBarMenu(), getBarMenu()]);
const saves = await Promise.allSettled(readers.map((r, i) => setBarMenu(sample(`edit ${i}`), r.configRevision)));
assert.equal(saves.filter(s => s.status === 'fulfilled').length, 1);
assert.equal(saves.find(s => s.status === 'rejected').reason.status, 409);
assert.deepEqual(value, sample('edit 0'));
await assert.rejects(setBarMenu(sample('legacy')), e => e.status === 409);
failure = 'database failure';
await assert.rejects(setBarMenu(sample('failed'), revision), /database failure/);
failure = null;
assert.deepEqual(value, sample('edit 0'));
assert.ok(requests.some(r => r.mode === 'update' && 'revision' in r.filters), 'CAS predicate belongs to UPDATE');
for (const [file, name] of [['team', 'moveTeamMember'], ['cocktails', 'moveCocktail']]) {
  const fns = await load(`../api/_lib/${file}.js`, { supabase: fixture }, name);
  failure = 'update denied';
  await assert.rejects(fns[name]('a', 'down'), /update denied/);
  failure = null;
  await assert.rejects(fns[name]('a', 'down'), /Не удалось сохранить порядок/);
}
console.log('PASS concurrent insert/update, stale/legacy editor, database failure, reorder failure/zero rows');

// The editor must retain its original base even if a late GET changes host props.
const editorSource = await readFile(new URL('../src/menu/MenuInlineEditor.jsx', import.meta.url), 'utf8');
assert.match(editorSource, /const configRevision = useRef\(initial.configRevision\)/);
assert.match(editorSource, /BarMenuService.save\(fromDraft\(draft\), configRevision.current\)/);
const failedSave = editorSource.slice(editorSource.indexOf('async function handleSave()'), editorSource.indexOf('  return (', editorSource.indexOf('async function handleSave()')));
assert.match(failedSave, /catch.*[\s\S]*setErr/);
assert.doesNotMatch(failedSave.split('catch')[1], /setDraft|onSaved|location/);

let err = '', saving = false, savedCalls = 0, toastCalls = 0;
const draft = sample('unsaved draft');
const realHandleSave = new Function('setErr', 'setSaving', 'BarMenuService', 'fromDraft', 'draft', 'configRevision', 'toast', 'onSaved', `${failedSave}; return handleSave;`)(
  value => { err = value; }, value => { saving = value; },
  { save: async () => { throw Object.assign(new Error('concurrent conflict'), { status: 409 }); } },
  value => value, draft, { current: first.configRevision },
  { success: () => { toastCalls++; } }, () => { savedCalls++; });
await realHandleSave();
assert.equal(err, 'concurrent conflict');
assert.equal(saving, false);
assert.equal(savedCalls, 0);
assert.equal(toastCalls, 0);
assert.deepEqual(draft, sample('unsaved draft'));
console.log('PASS real editor conflict callback keeps draft, exposes error, and emits no success');

// Installed SDK transport proof: the full real menu belongs in the body only.
const { createClient } = await import('@supabase/supabase-js');
const { BAR_MENU, CATEGORY_STORIES } = await import('../src/menu/barMenuData.js');
let transport;
const sdk = createClient('http://127.0.0.1:54321', 'fixture', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (url, options) => {
    transport = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ key: 'bar_menu', revision: 8 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } },
});
const real = await load('../api/_lib/barMenu.js', { supabase: sdk, BAR_MENU, CATEGORY_STORIES }, 'setBarMenu');
const transported = await real.setBarMenu({ menu: BAR_MENU, stories: CATEGORY_STORIES }, 7);
assert.ok(transport.url.length < 8192, 'CAS URL stays below 8KB for the real menu');
assert.ok(transport.url.includes('revision=eq.7'));
assert.ok(!transport.url.includes('value='));
assert.ok(Buffer.byteLength(JSON.stringify(transport.body), 'utf8') > 16000, 'large real menu remains in the body');
assert.equal(transported.configRevision, 8);
console.log('PASS installed SDK real menu transport: short revision URL and full menu body');
