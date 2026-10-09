import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.fetch = () => { throw new Error('Network forbidden'); };
const root = await mkdtemp(path.join(os.tmpdir(), 'cpjc-event-delete-'));
process.env.EVENT_UPLOADS_DIR = root;
const fixture = globalThis.__eventDeleteTest = { rows: [], readError: null, deleteError: null };
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../api/_lib/events.js', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external',
  plugins: [{ name: 'isolated-db', setup(b) {
    b.onResolve({ filter: /supabase\.js$/ }, () => ({ path: 'db', namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `export const supabase = { from() {
      let deleting = false, predicates = [], start = 0, end = Infinity;
      const q = { select() { return q; }, delete() { deleting = true; return q; },
        eq(k,v) { predicates.push(r => r[k] === v); return q; },
        neq(k,v) { predicates.push(r => r[k] !== v); return q; }, order() { return q; },
        range(a,b) { start=a; end=b+1; return q; },
        then(resolve) { const f=globalThis.__eventDeleteTest;
          const error=deleting ? f.deleteError : f.readError;
          const data=f.rows.filter(r => predicates.every(p => p(r))).slice(start,end);
          if (deleting && !error) { f.rows=f.rows.filter(r => !predicates.every(p => p(r))); f.afterDelete?.(); }
          return Promise.resolve({ data, error }).then(resolve);
        }
      }; return q;
    } };`, loader: 'js' }));
  } }],
});
// A temp module next to this test resolves installed sharp without touching .env.
const modulePath = fileURLToPath(new URL('./.event-delete-test-bundle.mjs', import.meta.url));
await writeFile(modulePath, bundled.outputFiles[0].text);
const { deleteEvent } = await import(pathToFileURL(modulePath));
const url = '/uploads/events/ev_source/0.webp';
const dir = path.join(root, 'ev_source');
async function files() {
  await mkdir(dir, { recursive: true });
  for (const n of ['0.webp', '0.thumb.webp', '1.webp', '1.thumb.webp']) await writeFile(path.join(dir, n), 'fixture');
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
try {
  await test('deleting source preserves copied array references and thumbnails', async () => {
    await files(); fixture.rows = [{ id: 'ev_source' }, { id: 'ev_copy', image_urls: [url] }];
    await deleteEvent('ev_source');
    await access(path.join(dir, '0.webp')); await access(path.join(dir, '0.thumb.webp'));
    await assert.rejects(access(path.join(dir, '1.webp')));
  });
  await test('legacy reference is protected even when image_urls is populated', async () => {
    await files(); fixture.rows = [{ id: 'ev_source' }, { id: 'ev_legacy', image_urls: ['/other.webp'], image_url: url }];
    await deleteEvent('ev_source'); await access(path.join(dir, '0.webp'));
  });
  await test('reference query failure preserves database row and all files', async () => {
    await files(); fixture.rows = [{ id: 'ev_source' }]; fixture.readError = { message: 'read failed' };
    await assert.rejects(deleteEvent('ev_source')); assert.equal(fixture.rows.length, 1);
    await access(path.join(dir, '1.webp')); fixture.readError = null;
  });
  await test('database delete failure preserves files', async () => {
    await files(); fixture.rows = [{ id: 'ev_source' }]; fixture.deleteError = { message: 'delete failed' };
    await assert.rejects(deleteEvent('ev_source')); await access(path.join(dir, '0.webp')); fixture.deleteError = null;
  });
  await test('references past the first database page preserve files', async () => {
    await files(); fixture.rows = Array.from({ length: 500 }, (_, i) => ({ id: 'filler_' + i }));
    fixture.rows.push({ id: 'ev_late_copy', image_urls: [url] });
    await deleteEvent('ev_source'); await access(path.join(dir, '0.webp'));
  });
  await test('copy committed during database delete is preserved by refreshed references', async () => {
    await files(); fixture.rows = [{ id: 'ev_source' }];
    fixture.afterDelete = () => { fixture.rows.push({ id: 'ev_copy', image_urls: [url] }); };
    await deleteEvent('ev_source'); await access(path.join(dir, '0.webp')); fixture.afterDelete = null;
  });
  await test('reference query failure after deletion returns pending cleanup and preserves files', async () => {
    await files(); fixture.rows = [{ id: 'ev_source' }];
    fixture.afterDelete = () => { fixture.readError = { message: 'post-delete read failed' }; };
    const result = await deleteEvent('ev_source');
    assert.equal(result.cleanupPending, true); assert.equal(fixture.rows.length, 0);
    await access(path.join(dir, '0.webp')); await access(path.join(dir, '1.webp'));
    fixture.readError = null; fixture.afterDelete = null;
  });
  await test('malformed id cannot delete another event folder', async () => {
    await files(); await assert.rejects(deleteEvent('ev_/source')); await access(path.join(dir, '0.webp'));
  });
  await test('cleanup handles orphan thumbnails and preserves unknown files', async () => {
    await files(); fixture.rows = []; await writeFile(path.join(dir, '2.thumb.webp'), 'orphan');
    await writeFile(path.join(dir, 'notes.txt'), 'unknown');
    assert.equal((await deleteEvent('ev_source')).cleanupPending, false);
    await assert.rejects(access(path.join(dir, '2.thumb.webp'))); await access(path.join(dir, 'notes.txt'));
    await rm(path.join(dir, 'notes.txt'));
  });
  await test('cleanup failure returns successful deletion with warning and permits retry', async () => {
    await files(); await rm(path.join(dir, '1.webp')); await mkdir(path.join(dir, '1.webp'));
    fixture.rows = [{ id: 'ev_source' }];
    const result = await deleteEvent('ev_source');
    assert.equal(fixture.rows.length, 0); assert.equal(result.cleanupPending, true);
    await rm(path.join(dir, '1.webp'), { recursive: true });
    assert.equal((await deleteEvent('ev_source')).cleanupPending, false);
  });
  console.log(`${passed} passed`);
} finally {
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(root, { recursive: true, force: true }); await rm(modulePath, { force: true });
  delete globalThis.__eventDeleteTest;
}
