// Executes the real EventModal callbacks with hook/FileReader/API doubles.
// No browser, production requests, .env files, or database writes.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, access, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

globalThis.fetch = () => { throw new Error('Network is forbidden in this test'); };
const source = await readFile(new URL('../src/admin/AdminPage.jsx', import.meta.url), 'utf8');
const start = source.indexOf('function EventModal({ initial, onSave, onClose }) {');
const end = source.indexOf('  const thumb = ', start);
assert.ok(start >= 0 && end > start, 'real editor callbacks must be found');
const modal = new Function('initial', 'onSave', 'onClose', 'useState', 'useRef', 'EventsService', 'genEventId', 'todayIso', 'MAX_EVENT_PHOTOS', 'FileReader',
  source.slice(start, end).split('\n').slice(1).join('\n') + '\nreturn { photos, err, saving, uploading, handleFiles, removePhoto, handleSubmit, close: typeof handleClose === "function" ? handleClose : onClose };');
const old = '/uploads/events/ev_test/0.webp';
const fresh = '/uploads/events/ev_test/1.webp';
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function editor({ originals = [old], failSave = false, failDelete = false, uploadWait, saveWait, deleteWait } = {}) {
  let slots = [], cursor = 0, view, published = [...originals], closed = 0, uploadIndex = 1;
  const calls = [];
  const state = initial => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
    return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
  };
  const ref = value => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = { current: value };
    return slots[i];
  };
  const service = {
    async uploadPhoto() { calls.push(['upload']); if (uploadWait) await uploadWait.promise; return { url: `/uploads/events/ev_test/${uploadIndex++}.webp` }; },
    async deletePhoto(id, url) {
      calls.push(['delete', url]);
      if (deleteWait) await deleteWait.promise;
      if (failDelete === true || (failDelete instanceof Set && failDelete.has(url))) throw new Error('cleanup failed');
      return {};
    },
  };
  const onSave = async data => {
    calls.push(['save', [...data.imageUrls]]);
    if (saveWait) await saveWait.promise;
    if (failSave) throw new Error('database failed');
    published = [...data.imageUrls];
    return { ...data, imageUrls: [...published] };
  };
  class Reader {
    readAsDataURL() { this.result = 'data:image/webp;base64,dGVzdA=='; this.onload(); }
  }
  const render = () => {
    cursor = 0;
    view = modal({ id: 'ev_test', title: 'Test', imageUrls: originals }, onSave, () => { closed++; }, state, ref, service, () => 'ev_test', () => '2099-01-01', 10, Reader);
    return view;
  };
  render();
  return {
    calls, render, get view() { return view; }, get published() { return published; }, get closed() { return closed; },
    remove(url) { view.removePhoto(url); render(); },
    async upload(files = [{ size: 4, name: 'test.webp' }]) { await view.handleFiles(files); render(); },
    async close() { await view.close(); render(); },
    async save() { await view.handleSubmit({ preventDefault() {} }); render(); },
    allowSave() { failSave = false; }, allowDelete() { failDelete = false; },
  };
}
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
await test('remove then cancel never deletes a published file', async () => {
  const e = editor(); e.remove(old);
  assert.deepEqual(e.view.photos, []);
  assert.deepEqual(e.calls, []);
  await e.close();
  assert.deepEqual(e.published, [old]);
  assert.deepEqual(e.calls, []);
  assert.equal(e.closed, 1);
});
await test('failed save retains originals and new upload for a safe retry', async () => {
  const e = editor({ failSave: true }); await e.upload(); e.remove(old); await e.save();
  assert.deepEqual(e.published, [old]);
  assert.equal(e.calls.filter(c => c[0] === 'delete').length, 0);
  assert.equal(e.view.err, 'database failed');
  assert.equal(e.closed, 0);
  e.allowSave(); await e.save();
  assert.deepEqual(e.published, [fresh]);
  assert.deepEqual(e.calls.slice(-2), [['save', [fresh]], ['delete', old]]);
  assert.equal(e.closed, 1);
});
await test('cancel cleans only newly uploaded files including ones removed from draft', async () => {
  const e = editor(); await e.upload(); e.remove(fresh); e.remove(old); await e.close();
  assert.deepEqual(e.calls.filter(c => c[0] === 'delete'), [['delete', fresh]]);
  assert.deepEqual(e.published, [old]);
});
await test('successful save cleans excluded uploads but retains saved uploads', async () => {
  const e = editor(); await e.upload(); e.remove(fresh); await e.save();
  assert.deepEqual(e.published, [old]);
  assert.deepEqual(e.calls.slice(-2), [['save', [old]], ['delete', fresh]]);
});
await test('post-save cleanup failure reports saved state and retry does not save again', async () => {
  const e = editor({ failDelete: true }); e.remove(old); await e.save();
  assert.deepEqual(e.published, []);
  assert.match(e.view.err, /[Сс]охранено/);
  assert.equal(e.closed, 0);
  e.allowDelete(); await e.save();
  assert.equal(e.calls.filter(c => c[0] === 'save').length, 1);
  assert.equal(e.closed, 1);
});
await test('cancel cleanup failure is visible and can be retried', async () => {
  const e = editor({ failDelete: true }); await e.upload(); await e.close();
  assert.match(e.view.err, /cleanup failed/);
  assert.equal(e.closed, 0);
  e.allowDelete(); await e.close(); assert.equal(e.closed, 1);
  assert.deepEqual(e.published, [old]);
});
await test('partial cancel cleanup cannot publish or edit a draft with deleted uploads', async () => {
  const second = '/uploads/events/ev_test/2.webp';
  const e = editor({ failDelete: new Set([second]) });
  await e.upload([{ size: 4, name: 'a.webp' }, { size: 4, name: 'b.webp' }]);
  assert.deepEqual(e.view.photos, [old, fresh, second]);
  await e.close();
  assert.deepEqual(e.calls.filter(c => c[0] === 'delete'), [['delete', fresh], ['delete', second]]);
  assert.match(e.view.err, /cleanup failed/);
  assert.equal(e.closed, 0);
  await e.save(); await e.upload(); e.remove(old);
  assert.equal(e.calls.filter(c => c[0] === 'save').length, 0, 'deleted upload must never be published');
  assert.equal(e.calls.filter(c => c[0] === 'upload').length, 2, 'cancelling draft must not accept new uploads');
  assert.deepEqual(e.view.photos, [old, fresh, second], 'cancelling draft must stay locked until close retry');
  assert.deepEqual(e.published, [old]);
  e.allowDelete(); await e.close();
  assert.equal(e.closed, 1);
  assert.deepEqual(e.calls.filter(c => c[0] === 'delete'), [['delete', fresh], ['delete', second], ['delete', second]], 'retry only unfinished cancellation cleanup');
  assert.deepEqual(e.published, [old]);
});
await test('close and save are ignored while upload is in progress', async () => {
  const wait = deferred(), e = editor({ uploadWait: wait });
  const task = e.upload(); await Promise.resolve(); await Promise.resolve(); e.render();
  await e.close(); await e.save();
  assert.equal(e.closed, 0);
  assert.equal(e.calls.filter(c => c[0] === 'save').length, 0);
  wait.resolve(); await task; await e.close();
  assert.deepEqual(e.calls.filter(c => c[0] === 'delete'), [['delete', fresh]]);
});
await test('multi-file batch observes the updated draft photo limit', async () => {
  const originals = Array.from({ length: 9 }, (_, n) => `/uploads/events/ev_test/${n + 10}.webp`);
  const e = editor({ originals }); await e.upload([{ size: 4, name: 'a' }, { size: 4, name: 'b' }]);
  assert.equal(e.calls.filter(c => c[0] === 'upload').length, 1);
  assert.equal(e.view.photos.length, 10);
});
await test('close and a second save cannot race an in-progress save', async () => {
  const wait = deferred(), e = editor({ saveWait: wait }); e.remove(old);
  const task = e.save(); e.render(); await e.close(); await e.save();
  assert.equal(e.closed, 0);
  assert.equal(e.calls.filter(c => c[0] === 'save').length, 1);
  assert.equal(e.calls.filter(c => c[0] === 'delete').length, 0);
  wait.resolve(); await task;
  assert.deepEqual(e.calls, [['save', []], ['delete', old]]);
  assert.equal(e.closed, 1);
});
await test('close after a cleanup warning preserves every newly published upload', async () => {
  const e = editor({ failDelete: true }); await e.upload(); e.remove(old); await e.save();
  assert.deepEqual(e.published, [fresh]);
  await e.close();
  assert.deepEqual(e.calls.filter(c => c[0] === 'delete'), [['delete', old]]);
  assert.equal(e.closed, 1);
});
await test('inherited photos are removed from draft without deleting another event folder', async () => {
  const inherited = '/uploads/events/ev_other/0.webp';
  const e = editor({ originals: [inherited] }); e.remove(inherited); await e.save();
  assert.deepEqual(e.calls, [['save', []]]);
});

// Bundle the actual API wrapper, replacing its DB/auth/file dependencies only.
// The fixture models both JSONB arrays and legacy image_url references.
globalThis.__eventPhotoTest = { rows: [], deleted: [], error: null };
const stubs = {
  'session.js': 'export async function getUser() { return { role: "admin" }; }',
  'events.js': 'export async function getEvents() { return []; } export async function createEvent() {} export async function updateEvent() {} export async function deleteEvent() {}',
  'eventPhotos.js': 'export const MAX_SOURCE_BYTES = 10485760; export async function saveEventPhoto() {} export async function deleteEventPhoto(id, url) { globalThis.__eventPhotoTest.deleted.push([id, url]); }',
  'supabase.js': `export const supabase = { from(table) {
    if (table !== 'events') throw new Error('Unexpected table');
    let predicate = () => true;
    const q = {
      select() { return q; },
      contains(key, values) { predicate = r => values.every(v => Array.isArray(r[key]) && r[key].includes(v)); return q; },
      eq(key, value) { predicate = r => r[key] === value; return q; },
      limit() { return q; },
      then(resolve) { const f = globalThis.__eventPhotoTest; return Promise.resolve({ data: f.rows.filter(predicate).slice(0, 1), error: f.error }).then(resolve); },
    }; return q;
  } };`,
};
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../api/events.js', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'isolated-event-dependencies', setup(b) {
    b.onResolve({ filter: /\/\_lib\/(session|events|eventPhotos|supabase)\.js$/ }, args => ({ path: path.basename(args.path), namespace: 'event-test' }));
    b.onLoad({ filter: /.*/, namespace: 'event-test' }, args => ({ contents: stubs[args.path], loader: 'js' }));
  } }],
});
const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
async function deleteViaApi(rows, error = null) {
  const f = globalThis.__eventPhotoTest;
  f.rows = rows; f.error = error; f.deleted = [];
  let status = 200, body;
  await handler({ method: 'POST', headers: {}, body: { action: 'delete_photo', eventId: 'ev_test', url: old } }, {
    status(n) { status = n; return this; }, setHeader() { return this; }, end(value) { body = JSON.parse(value); },
  });
  return { status, body, deleted: f.deleted };
}
await test('cleanup preserves a photo still referenced by a duplicated event', async () => {
  const r = await deleteViaApi([{ id: 'ev_copy', image_urls: [old], image_url: '' }]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.deleted, []);
  assert.equal(r.body.retained, true);
});
await test('cleanup after a lost save response preserves the newly published file', async () => {
  const r = await deleteViaApi([{ id: 'ev_test', image_urls: [old], image_url: old }]);
  assert.deepEqual(r.deleted, []);
});
await test('cleanup preserves a legacy single-photo reference', async () => {
  const r = await deleteViaApi([{ id: 'ev_legacy', image_urls: [], image_url: old }]);
  assert.deepEqual(r.deleted, []);
});
await test('cleanup deletes an unreferenced file after reference checks succeed', async () => {
  const r = await deleteViaApi([{ id: 'ev_test', image_urls: [], image_url: '' }]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.deleted, [['ev_test', old]]);
});
await test('DB reference-check failure stops deletion and returns an error', async () => {
  const originalError = console.error; console.error = () => {};
  let r;
  try { r = await deleteViaApi([], { message: 'isolated DB failure' }); }
  finally { console.error = originalError; }
  assert.equal(r.status, 500);
  assert.deepEqual(r.deleted, []);
});

// Verify the actual filesystem deletion helper on explicitly isolated temp files.
const tempRoot = path.resolve(await mkdtemp(path.join(os.tmpdir(), 'cpjc-event-photo-test-')));
assert.ok(tempRoot.startsWith(path.resolve(os.tmpdir()) + path.sep));
process.env.EVENT_UPLOADS_DIR = tempRoot;
const fileHelper = await import('../api/_lib/eventPhotos.js');
assert.equal(path.resolve(fileHelper.EVENT_UPLOADS_DIR), tempRoot);
const dir = path.join(tempRoot, 'ev_test');
await mkdir(dir);
const mainFile = path.join(dir, '0.webp'), thumbFile = path.join(dir, '0.thumb.webp');
async function resetFiles() { await writeFile(mainFile, 'main'); await writeFile(thumbFile, 'thumb'); }
try {
  await test('a different event URL cannot delete files with the same index', async () => {
    await resetFiles();
    await assert.rejects(fileHelper.deleteEventPhoto('ev_test', '/uploads/events/ev_other/0.webp'));
    await access(mainFile); await access(thumbFile);
  });
  await test('malformed event URL is rejected without touching either file', async () => {
    await resetFiles();
    await assert.rejects(fileHelper.deleteEventPhoto('ev_test', 'https://example.com/0.webp'));
    await access(mainFile); await access(thumbFile);
  });
  await test('noncanonical index cannot bypass reference checks by aliasing an existing file', async () => {
    await resetFiles();
    await assert.rejects(fileHelper.deleteEventPhoto('ev_test', '/uploads/events/ev_test/00.webp'));
    await access(mainFile); await access(thumbFile);
  });
  await test('an owned unreferenced photo deletes main and thumbnail idempotently', async () => {
    await resetFiles(); await fileHelper.deleteEventPhoto('ev_test', old);
    await assert.rejects(access(mainFile)); await assert.rejects(access(thumbFile));
    await fileHelper.deleteEventPhoto('ev_test', old);
  });
  await test('filesystem deletion failure is surfaced rather than reported as success', async () => {
    await resetFiles(); await rm(mainFile); await mkdir(mainFile);
    try {
      await assert.rejects(fileHelper.deleteEventPhoto('ev_test', old));
      await access(thumbFile);
    } finally { await rmdir(mainFile); }
  });
} finally {
  // Known files/directories only; no recursive removal of computed paths.
  await rm(mainFile, { force: true }); await rm(thumbFile, { force: true });
  await rmdir(dir); await rmdir(tempRoot);
  delete globalThis.__eventPhotoTest;
}
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
