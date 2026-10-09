// Executes the real deploy.sh against disposable local Git checkouts. SSH,
// npm, PM2 and HTTP are replaced only at their external boundaries; no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bash = process.env.DEPLOY_TEST_BASH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
const realGit = process.platform === 'win32' ? 'C:/Program Files/Git/cmd/git.exe'
  : spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
const posix = value => {
  if (process.platform !== 'win32') return value;
  // Git Bash mounts Windows' temporary directory as /tmp; use that spelling
  // consistently so pwd and realpath do not disagree on equivalent paths.
  if (value.startsWith(os.tmpdir() + path.sep)) return '/tmp/' + value.slice(os.tmpdir().length + 1).replaceAll('\\', '/');
  return value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
};
const sh = value => `'${value.replaceAll("'", "'\\''")}'`;
const run = (file, args, options = {}) => {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 120000, ...options });
  if (result.error) throw result.error;
  return result;
};
const checked = (file, args, options) => {
  const result = run(file, args, options);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
};
checked(bash, ['-n', posix(path.join(project, 'deploy.sh'))]);
const suite = fs.mkdtempSync(path.join(os.tmpdir(), 'cats-deploy-safety-'));
const write = (name, content) => { fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, content, { mode: 0o755 }); };
const git = (cwd, ...args) => checked(realGit, args, { cwd });
const oldRelease = 'releases/20260101-000000';
let passed = 0;
const caseFilter = process.argv[2];

function fixture(scenario) {
  const previousRelease = scenario === 'recovery-name' ? 'releases/20261009-recovery-final' : oldRelease;
  const root = path.join(suite, scenario);
  const remote = path.join(root, 'remote.git');
  const author = path.join(root, 'author');
  const server = path.join(root, "project ' quoted");
  const client = path.join(root, 'client');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '--bare', '--initial-branch=main', remote);
  fs.mkdirSync(author);
  git(author, 'init', '--initial-branch=main');
  git(author, 'config', 'user.name', 'Deploy fixture');
  git(author, 'config', 'user.email', 'fixture@example.invalid');
  write(path.join(author, 'app-version'), 'old');
  for (const name of ['gallery', 'cocktail']) write(path.join(author, 'src', 'data', `${name}Photos.generated.json`), JSON.stringify({ generatedAt: 'old timestamp', photos: ['preserved photo'] }));
  write(path.join(author, '.gitignore'), 'releases/\ndist_current\ndist/\n.deploy-lock/\n.deploy-link-*\n.env\nnode_modules/\n');
  git(author, 'add', '.'); git(author, 'commit', '-m', 'old');
  git(author, 'remote', 'add', 'origin', remote); git(author, 'push', '-u', 'origin', 'main');
  git(root, 'clone', remote, server);
  const oldSha = git(server, 'rev-parse', 'HEAD');
  write(path.join(author, 'app-version'), 'new');
  git(author, 'add', '.'); git(author, 'commit', '-m', 'new'); git(author, 'push', 'origin', 'main');
  const newSha = git(author, 'rev-parse', 'HEAD');
  fs.cpSync(path.join(project, 'node_modules', 'dotenv'), path.join(server, 'node_modules', 'dotenv'), { recursive: true });
  write(path.join(server, '.env'), 'NODE_ENV=production\nSESSION_SECRET=fixture-secret-long-enough-32-bytes\nSESSION_VERSION=release-fixture\nSESSION_TTL_SECONDS=604800\nAUTH_DEMO_OTP=false\nALLOW_DEMO_PAYMENTS=false\n');
  fs.mkdirSync(client); fs.mkdirSync(bin);
  fs.copyFileSync(path.join(project, 'deploy.sh'), path.join(client, 'deploy.sh'));
  write(path.join(client, '.deploy-info'), `server: fake-host\nssh_host_alias: fake-host\nproject_path_on_server: ${posix(server)}\n`);
  write(path.join(server, previousRelease, 'index.html'), 'old frontend');
  write(path.join(server, previousRelease, 'assets', 'old-lazy.js'), 'old lazy chunk');
  write(path.join(server, 'releases', 'unsafe-name', 'keep'), 'preserve');
  for (let i = 2; i <= 8; i++) write(path.join(server, 'releases', `2026010${i}-000000`, 'index.html'), 'previous');
  checked(bash, ['-c', `cd ${sh(posix(server))} && ln -s ${sh(previousRelease)} dist_current`], { env: { ...process.env, MSYS: 'winsymlinks' } });
  write(path.join(root, 'pm2-state.json'), JSON.stringify({ 'cats-api': { version: 'old', pid: 101, restarts: 0 }, 'cats-bot': { version: 'old', pid: 102, restarts: 0 } }));
  write(path.join(root, 'pm2-fixture.mjs'), `
import fs from 'node:fs';
const root = process.env.FIXTURE_NATIVE_ROOT;
const file = root + '/pm2-state.json';
const state = JSON.parse(fs.readFileSync(file));
const version = fs.readFileSync(process.env.FIXTURE_NATIVE_SERVER + '/app-version', 'utf8');
const [command, name] = process.argv.slice(2);
if (command === 'describe') process.exit(process.env.SCENARIO === 'missing-bot' && name === 'cats-bot' ? 1 : 0);
if (command === 'restart') {
  if (version === 'new' && process.env.SCENARIO === 'bot-restart-fails' && name === 'cats-bot') process.exit(1);
  state[name].version = version; state[name].pid++; state[name].restarts++;
  state[name].env = Object.fromEntries(['NODE_ENV', 'SESSION_SECRET', 'SESSION_VERSION', 'SESSION_TTL_SECONDS', 'AUTH_DEMO_OTP', 'ALLOW_DEMO_PAYMENTS'].map(key => [key, process.env[key]]));
  if (version === 'new' && process.env.SCENARIO === 'environment-drift') state[name].env.SESSION_SECRET = 'wrong-value';
  fs.writeFileSync(file, JSON.stringify(state)); process.exit(0);
}
if (command === 'jlist') {
  if (version === 'new' && process.env.SCENARIO === 'flapping-api') { state['cats-api'].pid++; state['cats-api'].restarts++; fs.writeFileSync(file, JSON.stringify(state)); }
  console.log(JSON.stringify(Object.entries(state).filter(([name]) => !(process.env.SCENARIO === 'missing-bot' && name === 'cats-bot')).map(([name, value]) => ({ name, pid: value.pid, pm2_env: { ...value.env, status: 'online', restart_time: value.restarts } }))));
  process.exit(0);
}
if (command === 'save') process.exit(0);
console.error('Unknown PM2 command: ' + command); process.exit(2);
`);
  // On Windows Node cannot spawn a Unix shebang executable directly. Adapt
  // only that OS boundary; the deployment's actual restart Node code still runs.
  write(path.join(root, 'windows-spawn.cjs'), `
if (process.platform === 'win32') {
  const cp = require('node:child_process'); const original = cp.spawnSync;
  cp.spawnSync = (command, args, options) => command === 'pm2'
    ? original(process.env.DEPLOY_TEST_BASH, ['-c', 'pm2 "$@"', 'pm2', ...args], options)
    : original(command, args, options);
  require('node:module').syncBuiltinESMExports();
}
`);
  const wrapper = (name, body) => write(path.join(bin, name), `#!/usr/bin/env bash\nset -eu\nprintf '%s\\n' '${name}' >> "$FIXTURE_ROOT/commands"\n${body}\n`);
  wrapper('ssh', 'printf "%s\\n" "$*" > "$FIXTURE_ROOT/ssh-options"\nfor argument; do remote="$argument"; done\nexec bash -c "$remote"');
  wrapper('git', 'exec "$REAL_GIT" "$@"');
  wrapper('npm', `version=$(cat app-version)
if [[ "$1" == ci ]]; then
  if [[ "$version" == new && "$SCENARIO" == install-fails ]]; then exit 1; fi
  printf '%s' "$version" > "$FIXTURE_ROOT/dependencies-version"
elif [[ "$1" == run && "$2" == build ]]; then
  if [[ "$SCENARIO" == build-fails ]]; then exit 1; fi
  mkdir -p dist/assets; printf 'new frontend' > dist/index.html; printf 'new chunk' > dist/assets/new.js
  node -e 'const fs=require("fs"); for (const kind of ["gallery", "cocktail"]) { const file="src/data/"+kind+"Photos.generated.json"; const value=JSON.parse(fs.readFileSync(file)); value.generatedAt="new timestamp"; if(process.env.SCENARIO === "manifest-content-changed") value.photos=["unexpected new photo"]; fs.writeFileSync(file,JSON.stringify(value)); }'
else exit 2; fi`);
  wrapper('pm2', 'exec node "$FIXTURE_ROOT/pm2-fixture.mjs" "$@"');
  wrapper('curl', `if [[ "$(cat app-version)" == new && "$SCENARIO" == health-fails ]]; then exit 22; fi
printf '{"ok":true}'`);
  wrapper('sleep', 'exit 0');
  const env = { ...process.env, MSYS: 'winsymlinks', FIXTURE_ROOT: posix(root), FIXTURE_NATIVE_ROOT: root, FIXTURE_NATIVE_SERVER: server, REAL_GIT: posix(realGit), SCENARIO: scenario, DEPLOY_TEST_BASH: bash,
    NODE_OPTIONS: `--require=${JSON.stringify(path.join(root, 'windows-spawn.cjs'))}` };
  const invoke = () => run(bash, ['-c', `export PATH=${sh(posix(bin))}:"$PATH"; bash deploy.sh`], { cwd: client, env });
  const target = () => checked(bash, ['-c', `cd ${sh(posix(server))} && readlink dist_current`]);
  return { root, server, oldSha, newSha, oldRelease: previousRelease, invoke, target };
}

function test(name, verify) {
  if (caseFilter && caseFilter !== name) return;
  const f = fixture(name);
  verify(f);
  passed++; console.log(`PASS ${name}`);
}
try {
  for (const scenario of ['success', 'recovery-name']) test(scenario, f => {
    const result = f.invoke();
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const target = f.target();
    assert.notEqual(target, f.oldRelease);
    assert.equal(git(f.server, 'rev-parse', 'HEAD'), f.newSha);
    assert.equal(fs.readFileSync(path.join(f.server, target, 'index.html'), 'utf8'), 'new frontend');
    assert.equal(fs.readFileSync(path.join(f.server, target, 'assets', 'old-lazy.js'), 'utf8'), 'old lazy chunk');
    assert.ok(fs.existsSync(path.join(f.server, 'releases', 'unsafe-name', 'keep')));
    assert.ok(fs.existsSync(path.join(f.server, f.oldRelease)), 'previous live release must survive cleanup');
    assert.equal(git(f.server, 'status', '--porcelain', '--untracked-files=no'), '', 'timestamp-only generated files must not dirty the next deployment');
    assert.equal(Object.values(JSON.parse(fs.readFileSync(path.join(f.root, 'pm2-state.json')))).every(p => p.version === 'new'), true);
    const ssh = fs.readFileSync(path.join(f.root, 'ssh-options'), 'utf8');
    assert.match(ssh, /BatchMode=yes/); assert.match(ssh, /ConnectTimeout=/);
  });
  for (const scenario of ['build-fails', 'install-fails', 'manifest-content-changed', 'bot-restart-fails', 'health-fails', 'flapping-api', 'environment-drift']) test(scenario, f => {
    const result = f.invoke();
    assert.notEqual(result.status, 0, 'failed release must not report success');
    assert.equal(f.target(), f.oldRelease);
    assert.equal(git(f.server, 'rev-parse', 'HEAD'), f.oldSha, 'backend code must roll back too');
    assert.equal(fs.readFileSync(path.join(f.root, 'dependencies-version'), 'utf8'), 'old');
    assert.equal(Object.values(JSON.parse(fs.readFileSync(path.join(f.root, 'pm2-state.json')))).every(p => p.version === 'old'), true);
    assert.ok(fs.existsSync(path.join(f.server, 'releases', '20260102-000000')), 'failed deploy must not prune releases');
  });
  for (const scenario of ['dirty-checkout', 'wrong-upstream', 'missing-bot', 'invalid-session-config', 'dist-symlink']) test(scenario, f => {
    if (scenario === 'dirty-checkout') write(path.join(f.server, 'app-version'), 'local edit');
    if (scenario === 'wrong-upstream') git(f.server, 'branch', '--unset-upstream');
    if (scenario === 'invalid-session-config') write(path.join(f.server, '.env'), 'NODE_ENV=production\nSESSION_SECRET=short\n');
    if (scenario === 'dist-symlink') checked(bash, ['-c', `cd ${sh(posix(f.server))} && ln -s ${sh(f.oldRelease)} dist`], { env: { ...process.env, MSYS: 'winsymlinks' } });
    const result = f.invoke();
    assert.notEqual(result.status, 0);
    assert.equal(f.target(), f.oldRelease);
    assert.equal(git(f.server, 'rev-parse', 'HEAD'), f.oldSha);
    assert.equal(fs.existsSync(path.join(f.root, 'dependencies-version')), false, 'preflight must not install or build');
    assert.equal(fs.readFileSync(path.join(f.server, f.oldRelease, 'index.html'), 'utf8'), 'old frontend', 'preflight must preserve the live frontend');
  });
  assert.ok(passed > 0, 'unknown deployment test case');
  console.log(`Deploy safety: ${passed} scenarios passed; Bash syntax passed; no network used.`);
} finally {
  // One native filesystem API deletes only this verified disposable suite root.
  assert.equal(path.dirname(suite), os.tmpdir());
  fs.rmSync(suite, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
}
