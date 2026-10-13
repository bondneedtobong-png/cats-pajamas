// One local/CI gate. All services bind loopback; no production env or SSH keys.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer as portServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createServer, preview } from 'vite';
import react from '@vitejs/plugin-react';
import { migrate } from '../ops/prepare-nginx-404.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestFiles = ['src/data/galleryPhotos.generated.json', 'src/data/cocktailPhotos.generated.json'];

async function freeLoopbackPort() {
  // Vite 5 treats dev port 0 as 5173, so choose a free OS-assigned port first.
  // strictPort ensures a competing bind causes failure, never reuse/fallback.
  const probe = portServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function restoreGeneratedMetadata(snapshots) {
  // Preserve the starting workspace, including another author's local edits.
  // Restore only generatedAt; a changed photo list fails without discarding it.
  for (const [file, original] of snapshots) {
    const before = JSON.parse(original), after = JSON.parse(await readFile(file, 'utf8'));
    delete before.generatedAt; delete after.generatedAt;
    assert(isDeepStrictEqual(before, after), `Build changed photo content in ${path.basename(file)}; review the generated changes`);
    await writeFile(file, original);
  }
}

async function main() {
  process.chdir(root);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'cats-check-'));
  const emptyEnv = path.join(temporary, 'empty.env');
  await writeFile(emptyEnv, '');
  // dotenv/config and Vite must not read private local/server credentials.
  const env = { ...process.env, DOTENV_CONFIG_PATH: emptyEnv,
    SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '',
    TELEGRAM_BOT_TOKEN: '', TELEGRAM_STAFF_CHAT_ID: '', TELEGRAM_ADMIN_IDS: '', TELEGRAM_STAFF_IDS: '',
    VITE_API_BASE: '', VITE_GA_ID: '', VITE_YM_ID: '',
    AUTH_DEMO_OTP: 'false', ALLOW_DEMO_PAYMENTS: 'false' };
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  let activeChild, server, builtPreview, stopped = false;
  const stopChild = () => {
    if (!activeChild || activeChild.exitCode !== null) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(activeChild.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    else { try { process.kill(-activeChild.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  };
  const interrupt = () => { stopped = true; stopChild(); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  async function step(label, executable, args, timeoutMs = 180000) {
    assert(!stopped, 'Check interrupted');
    console.log(`\n→ ${label}`);
    await new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd: root, env, stdio: 'inherit', windowsHide: true, detached: process.platform !== 'win32' });
      activeChild = child;
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; stopChild(); }, timeoutMs);
      child.once('error', error => { clearTimeout(timer); activeChild = undefined; reject(error); });
      child.once('close', (code, signal) => {
        clearTimeout(timer); activeChild = undefined;
        if (timedOut) reject(new Error(`${label}: timeout after ${timeoutMs / 1000}s`));
        else if (code !== 0 || stopped) reject(new Error(`${label}: ${stopped ? 'interrupted' : signal || `exit ${code}`}`));
        else resolve();
      });
    });
  }
  const node = (file, ...args) => step(file, process.execPath, [file, ...args]);
  const npm = script => step(`npm run ${script}`, process.execPath, [npmCli, 'run', script]);
  try {
    const dist = await lstat(path.join(root, 'dist')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    assert(!dist?.isSymbolicLink(), 'Refusing to build through a dist symlink');
    if (process.platform === 'linux') {
      const result = spawnSync('nginx', ['-v'], { encoding: 'utf8', timeout: 10000 });
      assert(!result.error && result.status === 0, 'Linux check requires nginx (CI installs it)');
    } else assert.equal(process.platform, 'win32', 'Run the nginx gate on Linux; only Windows may skip it');
    const snapshots = await Promise.all(manifestFiles.map(async file => [path.join(root, file), await readFile(path.join(root, file), 'utf8')]));
    try { await npm('build'); } finally { await restoreGeneratedMetadata(snapshots); }
    await npm('test:security');
    await npm('test:photos');
    await node('devtools/bot_e2e.mjs');
    await node('devtools/menu_import_test.mjs');
    await node('devtools/menu_book_test.mjs');
    await node('devtools/menu_content_test.mjs');
    await node('devtools/raw_404_test.mjs');

    server = await createServer({ root, configFile: false, envDir: temporary,
      define: { 'import.meta.env.VITE_API_BASE': '""', 'import.meta.env.VITE_GA_ID': '""', 'import.meta.env.VITE_YM_ID': '""' },
      server: { host: '127.0.0.1', port: await freeLoopbackPort(), strictPort: true, open: false, proxy: {} },
      plugins: [react(), { name: 'isolated-check-api-boundary', configureServer(instance) {
        instance.middlewares.use((request, response, next) => {
          if (/^\/api(?:\/|\?|$)/.test(request.url)) {
            response.writeHead(403, { 'Content-Type': 'application/json' });
            response.end('{"error":"Unexpected API request outside browser fixture"}');
          } else next();
        });
      } }],
    });
    await server.listen();
    const address = server.httpServer.address();
    assert(address && typeof address !== 'string' && address.address === '127.0.0.1');
    const url = `http://127.0.0.1:${address.port}`;
    console.log(`→ Own isolated Vite: ${url}`);
    for (const file of ['floorplan_keyboard_test.mjs', 'auth_dialog_test.mjs', 'event_photo_browser_test.mjs', 'mobile_usability_test.mjs']) {
      await node(`devtools/${file}`, url);
    }
    builtPreview = await preview({ root, configFile: false, envDir: temporary,
      preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
    const builtAddress = builtPreview.httpServer.address();
    assert(builtAddress && typeof builtAddress !== 'string' && builtAddress.address === '127.0.0.1');
    await node('devtools/page_meta_test.mjs', `http://127.0.0.1:${builtAddress.port}`);

    if (process.platform === 'linux') {
      const candidate = path.join(temporary, 'nginx-candidate.conf');
      await writeFile(candidate, migrate(await readFile(path.join(root, 'ops/nginx-before.fixture.conf'), 'utf8')));
      await step('isolated nginx integration', 'python3', ['ops/test_nginx_404.py', candidate, path.join(root, 'dist')], 30000);
    } else console.log('SKIP actual nginx integration: Windows; mandatory in Ubuntu CI.');
    console.log('\nPASS check: build, security, photos, bot, menu, accessibility, metadata, raw 404 and mobile browser flows.');
  } finally {
    stopChild();
    if (server) await server.close();
    if (builtPreview) {
      builtPreview.httpServer.closeAllConnections();
      await new Promise(resolve => builtPreview.httpServer.close(resolve));
    }
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    assert.equal(path.dirname(temporary), os.tmpdir());
    await rm(temporary, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(`\nFAIL check: ${error.message}`); process.exitCode = 1; }
}
