// Run: node devtools/bar_menu_security_test.mjs. No DB or network access.
// Every sanitizer call runs in a Worker so a synchronous regression can be killed.
import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

if (!isMainThread) {
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  const { sanitizeBarMenu } = await import('../api/_lib/barMenu.js');
  parentPort.postMessage({ started: true });
  parentPort.postMessage({ result: sanitizeBarMenu(workerData) });
} else {
  const group = (id, title = id) => ({
    id, title, categories: [{ title: 'Category', items: [{ name: 'Drink', price: '100' }] }],
  });
  async function isolated(payload) {
    const worker = new Worker(new URL(import.meta.url), { workerData: payload });
    try {
      return await new Promise((resolve, reject) => {
        let timer = setTimeout(() => reject(new Error('Worker startup timeout')), 10000);
        const finish = (fn, value) => { clearTimeout(timer); fn(value); };
        worker.on('message', (message) => {
          if (message.started) {
            clearTimeout(timer);
            timer = setTimeout(() => reject(new Error('sanitizeBarMenu did not return in 500 ms')), 500);
          } else finish(resolve, message.result);
        });
        worker.on('error', (error) => finish(reject, error));
        worker.on('exit', (code) => finish(reject, new Error(`Worker exited before result (${code})`)));
      });
    } finally {
      // Await forced termination even on timeout: the test runner cannot hang.
      await worker.terminate();
    }
  }

  const cases = [
    ['review collision', ['a', 'a-2', 'a'].map((id) => group(id)), ['a', 'a-2', 'a-3']],
    ['consecutive duplicates', ['a', 'a', 'a', 'a', 'a'].map((id) => group(id))],
    ['preexisting suffixes', ['a', 'a-3', 'a-4', 'a', 'a'].map((id) => group(id))],
    ['normalized slug collisions', [' A! ', 'a', 'A?', 'a-2'].map((id) => group(id))],
    ['title fallback collisions', [group('', 'Jazz!'), group('', 'jazz'), group('', 'JAZZ?')]],
    ['unchanged unique ids', ['wine', 'spirits', 'beer'].map((id) => group(id)), ['wine', 'spirits', 'beer']],
  ];
  let failed = 0;
  for (const [name, menu, expected] of cases) {
    try {
      const clean = await isolated({ menu, stories: { Category: 'Story' } });
      const ids = clean.menu.map((g) => g.id);
      assert.equal(ids.length, menu.length, 'all nonempty groups survive');
      assert.equal(new Set(ids).size, ids.length, 'all ids are unique');
      assert.deepEqual(clean.menu.map((g) => g.title), menu.map((g) => g.title.trim()));
      assert.ok(clean.menu.every((g) => g.categories[0].items[0].name === 'Drink'));
      assert.deepEqual(clean.stories, { Category: 'Story' });
      if (expected) assert.deepEqual(ids, expected);
      // Sanitizing a second time must preserve the generated anchors.
      assert.deepEqual(await isolated(clean), clean);
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
  console.log(failed ? `${failed} SCENARIOS FAILED` : 'ALL SCENARIOS PASS');
}
