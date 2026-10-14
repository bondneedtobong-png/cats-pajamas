// Actual server functions, routes, installed SDK transport and UI callbacks.
// Local fixtures only: no .env, network, production or Telegram.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import * as http from '../api/_lib/http.js';

globalThis.fetch = () => { throw new Error('Network forbidden'); };
async function load(file, dependencies, exports) {
  const source = (await readFile(new URL(file, import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/export default /g, '').replace(/export /g, '');
  return new Function(...Object.keys(dependencies), `${source}\nreturn { ${exports} };`)(...Object.values(dependencies));
}
const raw = [
  { id: 'a', name: 'A', sort_order: 0, active: true, bio: 'kept', price: '300' },
  { id: 'b', name: 'B', sort_order: 0, active: false, bio: 'kept b', price: '400' },
];
let response = { data: [raw[1], raw[0]], error: null }, reads = 0, calls = [], orders = [], filters = [], readError;
const fixture = {
  from(table) {
    const q = {
      select() { return q; }, order(key, options) { orders.push([table, key, options]); return q; },
      eq(key, value) { filters.push([key, value]); return q; },
      update() { throw new Error('Separate UPDATE forbidden'); },
      then(resolve, reject) { reads++; return Promise.resolve({ data: structuredClone(raw), error: readError }).then(resolve, reject); },
    }; return q;
  },
  async rpc(name, args) { calls.push({ name, args }); return structuredClone(response); },
};
const { reorderContent } = await load('../api/_lib/contentReorder.js', { supabase: fixture }, 'reorderContent');
const ui = await readFile(new URL('../src/admin/AdminPage.jsx', import.meta.url), 'utf8');
for (const [file, mover, getter, key, service, setter, tab] of [
  ['team', 'moveTeamMember', 'getTeamMembers', 'members', 'TeamService', 'setMembers', 'TabTeam'],
  ['cocktails', 'moveCocktail', 'getCocktails', 'cocktails', 'CocktailsService', 'setCocktails', 'TabMenu'],
]) {
  const fns = await load(`../api/_lib/${file}.js`, { supabase: fixture, reorderContent }, `${mover}, ${getter}`);
  calls = []; reads = 0; orders = []; filters = [];
  response = { data: [raw[1], raw[0]], error: null };
  const moved = await fns[mover]('a', 'down');
  assert.deepEqual(moved.map(item => item.id), ['b', 'a']);
  assert.equal(moved[0].active, false, 'admin response retains inactive entries');
  assert.equal(calls.length, 1); assert.equal(reads, 1, 'no racy read after RPC');
  assert.equal(calls[0].name, file === 'team' ? 'move_team_member_atomic' : 'move_cocktail_atomic');
  assert.deepEqual(calls[0].args, { p_id: 'a', p_direction: 'down', p_expected: raw.map(({ id, sort_order }) => ({ id, sort_order })) });
  assert.deepEqual(orders.map(order => order[1]), ['sort_order', 'id']);
  assert.deepEqual(filters, []);
  await fns[getter](); assert.deepEqual(filters, [['active', true]], 'public list keeps its active filter');
  for (const direction of ['left', null, undefined, 'UP']) {
    const before = reads; await assert.rejects(fns[mover]('a', direction), error => error.status === 400); assert.equal(reads, before);
  }
  for (const id of ['', undefined, 'unknown']) await assert.rejects(fns[mover](id, 'up'), error => error.status === 400);
  readError = { message: 'read failed' }; const before = calls.length;
  await assert.rejects(fns[mover]('a', 'down'), /read failed/); assert.equal(calls.length, before); readError = null;
  for (const code of ['PT409', '55P03', '40001', '40P01']) {
    response = { data: null, error: { code, message: 'conflict' } };
    await assert.rejects(fns[mover]('a', 'down'), error => error.status === 409);
  }
  response = { data: null, error: { code: 'PT400', message: 'missing' } };
  await assert.rejects(fns[mover]('a', 'down'), error => error.status === 400);
  response = { data: null, error: { code: 'P0001', message: 'second update failed' } };
  await assert.rejects(fns[mover]('a', 'down'), /second update failed/);
  for (const data of [null, [], [raw[0]]]) {
    response = { data, error: null }; await assert.rejects(fns[mover]('a', 'down'), /Не удалось сохранить порядок/);
  }

  // Run the actual HTTP handler: admin requirement, JSON status and unchanged
  // successful {members}/{cocktails} contract.
  let user = { role: 'admin' };
  const dependencies = { ...http, ...fns, getUser: async () => user };
  const { handler } = await load(`../api/${file}.js`, dependencies, 'handler');
  async function request(body) {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; return this; }, status(v) { this.code = v; return this; }, end(v) { this.body = v ? JSON.parse(v) : null; } };
    await handler({ method: 'POST', query: {}, body }, res); return res;
  }
  response = { data: null, error: { code: 'PT409', message: 'stale' } };
  let res = await request({ action: 'move', id: 'a', direction: 'down' }); assert.equal(res.code, 409); assert.match(res.body.error, /Порядок уже изменён/);
  res = await request({ action: 'move', id: 'a', direction: 'invalid' }); assert.equal(res.code, 400);
  for (const unauthorized of [null, { role: 'guest' }]) {
    user = unauthorized; const beforeCalls = calls.length;
    res = await request({ action: 'move', id: 'a', direction: 'down' }); assert.equal(res.code, 403); assert.equal(calls.length, beforeCalls);
  }
  user = { role: 'admin' }; response = { data: [raw[1], raw[0]], error: null };
  res = await request({ action: 'move', id: 'a', direction: 'down' }); assert.equal(res.code, 200); assert.deepEqual(res.body[key].map(row => row.id), ['b', 'a']);

  // Actual tab callback: no optimistic change, visible errors, refresh on 409,
  // and a failed refresh keeps displayed data.
  const start = ui.indexOf('  async function handleMove(', ui.indexOf(`function ${tab}(`));
  const end = ui.indexOf('  function handleDelete(', start);
  let shown = ['old'], errors = [], refreshes = 0, writes = 0, failMove, failRefresh;
  const callbackSource = ui.slice(start, end);
  const callback = new Function(service, setter, 'toast', 'moveRequest', `${callbackSource}; return handleMove;`)(
    { move: async (...args) => { assert.deepEqual(args, ['a', 'down']); if (failMove) throw failMove; return moved; },
      getAllAdmin: async () => { refreshes++; if (failRefresh) throw new Error('refresh failed'); return ['fresh']; } },
    value => { shown = value; writes++; }, { error: message => errors.push(message) }, { current: 0 });
  await callback('a', 'down'); assert.equal(shown, moved); assert.equal(writes, 1); assert.deepEqual(errors, []); assert.equal(refreshes, 0);
  failMove = Object.assign(new Error('conflict message'), { status: 409 });
  await callback('a', 'down'); assert.deepEqual(shown, ['fresh']); assert.deepEqual(errors, ['conflict message']); assert.equal(refreshes, 1);
  shown = ['still displayed']; failRefresh = true;
  await callback('a', 'down'); assert.deepEqual(shown, ['still displayed']); assert.match(errors.at(-1), /Не удалось обновить список/);
  failMove = new Error('generic failure'); const beforeRefresh = refreshes, beforeWrites = writes;
  await callback('a', 'down'); assert.equal(errors.at(-1), 'generic failure'); assert.equal(refreshes, beforeRefresh); assert.equal(writes, beforeWrites);
  const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
  const older = deferred(), newer = deferred();
  let requestCalls = 0;
  const concurrentCallback = new Function(service, setter, 'toast', 'moveRequest', `${callbackSource}; return handleMove;`)(
    { move: () => (++requestCalls === 1 ? older : newer).promise, getAllAdmin: async () => ['current refreshed order'] },
    value => { shown = value; }, { error: message => errors.push(message) }, { current: 0 });
  const olderRequest = concurrentCallback('a', 'down'), newerRequest = concurrentCallback('b', 'down');
  newer.reject(Object.assign(new Error('newer conflict'), { status: 409 })); await newerRequest;
  assert.deepEqual(shown, ['current refreshed order']);
  older.resolve(['old delayed order']); await olderRequest;
  assert.deepEqual(shown, ['current refreshed order'], 'late old success cannot overwrite newer conflict refresh');
  const refresh = deferred(), conflict = deferred(), successful = deferred(); requestCalls = 0;
  const refreshRaceCallback = new Function(service, setter, 'toast', 'moveRequest', `${callbackSource}; return handleMove;`)(
    { move: () => (++requestCalls === 1 ? conflict : successful).promise, getAllAdmin: () => refresh.promise },
    value => { shown = value; }, { error: message => errors.push(message) }, { current: 0 });
  const refreshRequest = refreshRaceCallback('a', 'down'); conflict.reject(Object.assign(new Error('older conflict'), { status: 409 }));
  await Promise.resolve(); await Promise.resolve();
  const successfulRequest = refreshRaceCallback('b', 'down'); successful.resolve(['newer success']); await successfulRequest;
  refresh.resolve(['old refreshed order']); await refreshRequest;
  assert.deepEqual(shown, ['newer success'], 'late old refresh cannot overwrite a newer move');

  // Run the actual list effect body and cleanup, sharing its generation with
  // handleMove. This covers initial/CRUD reloads as well as move responses.
  const effectStart = ui.indexOf('  useEffect(() => {', ui.indexOf(`function ${tab}(`)) + '  useEffect(() => {'.length;
  const effectEnd = ui.indexOf('  }, [tick]);', effectStart);
  const effectSource = ui.slice(effectStart, effectEnd);
  function listRaceFixture() {
    const generation = { current: 0 }, gets = [], moves = [], feedback = [];
    const serviceFixture = { getAllAdmin: () => { const request = deferred(); gets.push(request); return request.promise; },
      move: () => { const request = deferred(); moves.push(request); return request.promise; } };
    const apply = value => { shown = value; };
    const effect = new Function(service, setter, 'moveRequest', 'ApplicationsService', 'setApplications',
      `return function effect() { ${effectSource} };`)(serviceFixture, apply, generation, { getAllAdmin: async () => [] }, () => {});
    const move = new Function(service, setter, 'toast', 'moveRequest', `${callbackSource}; return handleMove;`)(
      serviceFixture, apply, { error: message => feedback.push(message) }, generation);
    return { effect, move, gets, moves, feedback, generation };
  }
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  const reloadFirst = listRaceFixture();
  const cleanupOldReload = reloadFirst.effect(), pendingMove = reloadFirst.move('a', 'down');
  cleanupOldReload(); // Cleanup for an older GET must not cancel a newer move.
  reloadFirst.moves[0].resolve(['move won']); await pendingMove;
  reloadFirst.gets[0].resolve(['stale initial or CRUD reload']); await flush();
  assert.deepEqual(shown, ['move won'], 'late initial/CRUD reload cannot overwrite a newer move');
  assert.deepEqual(reloadFirst.feedback, []);

  const moveFirst = listRaceFixture();
  const oldMove = moveFirst.move('a', 'down'); moveFirst.effect();
  moveFirst.gets[0].resolve(['newer CRUD reload']); await flush();
  moveFirst.moves[0].resolve(['stale move']); await oldMove;
  assert.deepEqual(shown, ['newer CRUD reload'], 'CRUD reload invalidates an older move response');
  const oldFailedMove = moveFirst.move('a', 'down'); moveFirst.effect();
  moveFirst.gets[1].resolve(['latest reload']); await flush();
  moveFirst.moves[1].reject(Object.assign(new Error('obsolete conflict'), { status: 409 })); await oldFailedMove;
  assert.deepEqual(shown, ['latest reload']); assert.deepEqual(moveFirst.feedback, [], 'late obsolete errors emit no false feedback');
  assert.equal(moveFirst.gets.length, 2, 'obsolete conflict does not issue another refresh');

  const cleanupRace = listRaceFixture();
  const cleanupOlder = cleanupRace.effect(), cleanupNewer = cleanupRace.effect(); cleanupOlder();
  cleanupRace.gets[1].resolve(['newest reload']); await flush();
  assert.deepEqual(shown, ['newest reload'], 'older cleanup cannot invalidate a newer reload');
  cleanupNewer(); cleanupRace.gets[0].resolve(['obsolete reload']); await flush();
  assert.deepEqual(shown, ['newest reload']);
  const unmounted = listRaceFixture(); const cleanupUnmounted = unmounted.effect(); cleanupUnmounted();
  unmounted.gets[0].resolve(['late cancelled reload']); await flush();
  assert.deepEqual(shown, ['newest reload'], 'cleanup invalidates its own pending GET');
  console.log(`PASS ${file}: one RPC, deterministic GET, status mapping/admin auth, actual UI success/conflict/failed refresh/generic failure`);
}

// Installed SDK sends expected snapshots in POST bodies, not large URLs.
let transport;
const sdk = createClient('http://127.0.0.1:54321', 'fixture', { auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (url, options) => {
    transport = { url: String(url), method: options.method, body: JSON.parse(options.body) };
    return new Response(JSON.stringify(raw), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } } });
const rpc = await load('../api/_lib/contentReorder.js', { supabase: sdk }, 'reorderContent');
await rpc.reorderContent('move_team_member_atomic', 'a', 'down', async () => raw.map(row => ({ id: row.id, sortOrder: row.sort_order })), row => row, 'missing');
assert.equal(transport.method, 'POST'); assert.ok(transport.url.endsWith('/rpc/move_team_member_atomic')); assert.equal(transport.body.p_expected.length, 2);

const migration = await readFile(new URL('../supabase/migrations/20261014202634_atomic_content_reorder.sql', import.meta.url), 'utf8');
const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const body = migration.slice(migration.indexOf('create or replace function'), migration.lastIndexOf("notify pgrst"));
assert.ok(schema.includes(body.trim()), 'schema and migration RPC definitions agree');
assert.doesNotMatch(body, /security definer|execute format|create unique/i);
assert.match(migration, /set local lock_timeout = '5s'/); assert.match(migration, /set local statement_timeout = '30s'/);
assert.match(migration, /notify pgrst, 'reload schema'/);
for (const functionBody of body.split('create or replace function').slice(1)) {
  const directionCheck = functionBody.indexOf("if p_direction is null or p_direction not in ('up', 'down')");
  const firstLock = functionBody.indexOf('lock table ');
  const firstRead = functionBody.indexOf('select coalesce(');
  const firstWrite = functionBody.indexOf('update public.');
  assert.ok(directionCheck >= 0 && directionCheck < firstLock && firstLock < firstRead && firstRead < firstWrite,
    'invalid postflight direction must raise PT400 before any lock/read/write');
  assert.match(functionBody.slice(directionCheck, firstLock), /raise sqlstate 'PT400'/);
}
console.log('PASS installed SDK snapshot body and migration/schema/security contract (real PostgreSQL tested separately in Linux CI)');
