import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, rmSync, existsSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import sharp from 'sharp';
import { encrypt, decrypt } from './backup-envelope.mjs';

const ops = dirname(fileURLToPath(import.meta.url));
const win = process.platform === 'win32';
const bash = win ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const shellPath = p => win ? p.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase()) : p;
const hash = b => createHash('sha256').update(b).digest('hex');
const python = spawnSync(win ? 'python' : 'python3', ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' });
assert.equal(python.status, 0, 'Fixture Python required');
const py = python.stdout.trim();
const temp = mkdtempSync(join(tmpdir(), 'cats-builder-test-'));
const tempIdentity = realpathSync(temp);
const runPython = (args, options = {}) => spawnSync(py, ['-B', ...args], { encoding: 'utf8', timeout: 30000, ...options });
const sh = (args, env = {}) => spawnSync(bash, args, { env: { ...process.env, ...env }, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
const tarRead = (archive, name) => {
  const r = sh(['-c', 'exec /usr/bin/tar -xOzf "$1" "$2"', 'fixture', shellPath(archive), name]);
  assert.equal(r.status, 0, 'Fixture tar member read');
  return r.stdout;
};
try {
  for (const name of ['backup-builder-before.fixture.sh', 'backup-builder.sh', 'ci-nginx-preflight.sh', 'ci-backup-restore.sh']) {
    assert.equal(sh(['-n', shellPath(join(ops, name))]).status, 0, 'Shell syntax: ' + name);
  }
  const baseline = readFileSync(join(ops, 'backup-builder-before.fixture.sh'), 'utf8');
  const candidate = readFileSync(join(ops, 'backup-builder.sh'), 'utf8');
  assert.equal(hash(Buffer.from(baseline)), '1f30569966ebb585694c7d077642615cf808d79685dfbf27f3055e0580bc199a');
  const bin = join(temp, 'bin'), inputs = join(temp, 'inputs'), live = join(temp, 'opt', 'cats-pajamas-uploads');
  for (const p of [bin, inputs, join(live, 'events', 'ev_fixture')]) mkdirSync(p, { recursive: true, mode: 0o700 });
  const main = await sharp({ create: { width: 17, height: 11, channels: 3, background: '#214365' } }).webp().toBuffer();
  const thumb = await sharp(main).resize(8, 6).webp().toBuffer();
  writeFileSync(join(live, 'events', 'ev_fixture', '0.webp'), main);
  writeFileSync(join(live, 'events', 'ev_fixture', '0.thumb.webp'), thumb);
  const sql = 'COPY public.events (id, image_urls) FROM stdin;\nev_fixture\t["/uploads/events/ev_fixture/0.webp"]\n\\.\n';
  writeFileSync(join(inputs, 'sql'), sql);
  for (const name of ['app', 'supabase', 'nginx']) writeFileSync(join(inputs, name), 'FIXTURE_SECRET_' + name + '\n');
  const stub = `#!/bin/bash
set -euo pipefail
case "$(basename "$0")" in
docker) [[ "$*" == 'exec supabase-db pg_dump -U postgres -d postgres' ]]; cat "$FIXTURE_INPUT/sql" ;;
date) [[ "$*" == '-u +%Y%m%d-%H%M%S' ]]; echo "${'${FIXTURE_STAMP:-20261020-120000}'}" ;;
flock) [[ "$*" == '-n 9' ]]; [[ "${'${FIXTURE_LOCK_BUSY:-0}'}" == 0 ]] ;;
python3) exec "$FIXTURE_PYTHON" -B "$@" ;;
tar)
  if [[ "${'${FIXTURE_FAIL_OUTER:-0}'}" == 1 && "$2" == */complete.tar.gz ]]; then printf partial > "$2"; exit 1; fi
  exec /usr/bin/tar "$@" ;;
esac
`;
  for (const name of ['docker', 'date', 'flock', 'python3', 'tar']) writeFileSync(join(bin, name), stub, { mode: 0o755 });
  function build(label, source, extra = {}) {
    const folder = join(temp, label), backups = join(folder, 'backups');
    mkdirSync(backups, { recursive: true });
    const paths = [
      ['/var/backups/cats-pajamas', shellPath(backups)],
      ['/var/lock/cats-pajamas-backup.lock', shellPath(join(folder, 'lock'))],
      ['/opt/cats-pajamas-club/.env', shellPath(join(inputs, 'app'))],
      ['/opt/supabase/docker/.env', shellPath(join(inputs, 'supabase'))],
      ['/etc/nginx/sites-available/cats-pajamas-club', shellPath(join(inputs, 'nginx'))],
      ['/usr/local/lib/cats-backup-runtime/backup-runtime-media.py', shellPath(join(ops, 'backup-runtime-media.py'))],
      ['-C /opt cats-pajamas-uploads', '-C "' + shellPath(join(temp, 'opt')) + '" cats-pajamas-uploads'],
      [' /opt/cats-pajamas-uploads ', ' "' + shellPath(live) + '" '],
    ];
    let text = source;
    // Transform fixture copies only; no source or production files are changed.
    for (const [from, to] of paths) text = text.replaceAll(from, to);
    const script = join(folder, 'builder.sh'); writeFileSync(script, text);
    const result = sh(['-c', 'export PATH="$FIXTURE_BIN:/usr/bin:/bin"; exec bash "$1"', 'fixture', shellPath(script)], {
      FIXTURE_BIN: shellPath(bin), FIXTURE_INPUT: shellPath(inputs), FIXTURE_PYTHON: shellPath(py), ...extra,
    });
    assert.ok(!Buffer.concat([result.stdout, result.stderr]).toString().includes('FIXTURE_SECRET_'), 'No config contents in diagnostics');
    assert.ok(!readdirSync(backups).some(n => n.startsWith('.stage-')), 'Owned stage always removed');
    return { result, backups, archive: join(backups, '20261020-120000.tar.gz') };
  }
  const old = build('old', baseline), fresh = build('new', candidate);
  assert.equal(old.result.status, 0, 'Baseline fixture succeeds');
  assert.equal(fresh.result.status, 0, 'Candidate fixture succeeds: ' + fresh.result.stderr.toString());
  for (const name of ['database.sql.gz', 'app.env', 'supabase.env', 'nginx.conf', 'runtime-uploads.tar.gz']) {
    assert.ok(tarRead(old.archive, './' + name).equals(tarRead(fresh.archive, name)), 'Original member data preserved: ' + name);
  }
  const listing = sh(['-c', 'exec /usr/bin/tar -tzf "$1"', 'fixture', shellPath(fresh.archive)]);
  assert.deepEqual(listing.stdout.toString().trim().split('\n').sort(), ['database.sql.gz', 'app.env', 'supabase.env', 'nginx.conf', 'runtime-uploads.tar.gz', 'runtime-manifest.json'].sort());
  const manifest = JSON.parse(tarRead(fresh.archive, 'runtime-manifest.json'));
  assert.equal(manifest.file_count, 2); assert.equal(manifest.event_pairs, 1); assert.equal(manifest.source_empty, false);
  let verify = runPython([join(ops, 'backup-runtime-media.py'), 'verify-backup', fresh.archive]);
  assert.equal(verify.status, 0, 'Candidate runtime proof verifies');
  const pem = generateKeyPairSync('rsa', { modulusLength: 4096, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const pub = join(temp, 'fixture-public.pem'), priv = join(temp, 'fixture-private.pem'), cipher = join(temp, 'fixture.enc'), restore = join(temp, 'restore');
  writeFileSync(pub, pem.publicKey, { mode: 0o600 }); writeFileSync(priv, pem.privateKey, { mode: 0o600 }); mkdirSync(restore);
  encrypt(fresh.archive, cipher, pub, hash(readFileSync(fresh.archive)), '20261020-120000.tar.gz');
  decrypt(cipher, resolve(restore), priv);
  const restored = join(restore, '20261020-120000.tar.gz');
  assert.ok(readFileSync(restored).equals(readFileSync(fresh.archive)), 'Envelope exact roundtrip');
  verify = runPython([join(ops, 'backup-runtime-media.py'), 'verify-backup', restored]);
  assert.equal(verify.status, 0, 'Restored archive manifest verifies');
  const nested = join(restore, 'nested.tar.gz'); writeFileSync(nested, tarRead(restored, 'runtime-uploads.tar.gz'));
  for (const [name, expected] of [['0.webp', main], ['0.thumb.webp', thumb]]) {
    const media = tarRead(nested, 'cats-pajamas-uploads/events/ev_fixture/' + name);
    assert.ok(media.equals(expected), 'Restored image hash/size exact');
    const decoded = await sharp(media, { failOn: 'error' }).raw().toBuffer({ resolveWithObject: true });
    assert.ok(decoded.info.width > 0 && decoded.data.length > 0, 'Full Sharp image decode');
  }
  const previous = readFileSync(fresh.archive);
  assert.notEqual(build('new', candidate).result.status, 0, 'Same timestamp refuses overwrite');
  assert.ok(readFileSync(fresh.archive).equals(previous), 'Previous completed archive preserved on duplicate');
  for (const kind of ['directory', 'directory-link']) {
    const backups = join(temp, kind, 'backups'), destination = join(backups, '20261020-120000.tar.gz');
    mkdirSync(backups, { recursive: true });
    const folder = kind === 'directory' ? destination : join(temp, 'linked-directory');
    mkdirSync(folder); writeFileSync(join(folder, 'preserve'), 'owned fixture');
    if (kind === 'directory-link') symlinkSync(folder, destination, win ? 'junction' : 'dir');
    assert.notEqual(build(kind, candidate).result.status, 0, 'Refuse timestamp directory/alias');
    assert.deepEqual(readdirSync(folder), ['preserve'], 'No publication into preexisting directory');
    assert.equal(readFileSync(join(folder, 'preserve'), 'utf8'), 'owned fixture');
  }
  const failed = build('new', candidate, { FIXTURE_FAIL_OUTER: '1', FIXTURE_STAMP: '20261020-120001' });
  assert.notEqual(failed.result.status, 0, 'Forced outer tar failure rejects');
  assert.ok(!existsSync(join(failed.backups, '20261020-120001.tar.gz')), 'No partial completed filename');
  assert.ok(readFileSync(failed.archive).equals(previous), 'Previous backup preserved on failure');
  const aged = join(fresh.backups, '20000101-000000.tar.gz'), keep = join(fresh.backups, 'preserve.txt');
  writeFileSync(aged, 'old'); writeFileSync(keep, 'keep'); utimesSync(aged, new Date('2000-01-01'), new Date('2000-01-01'));
  assert.equal(build('new', candidate, { FIXTURE_STAMP: '20261020-120002' }).result.status, 0);
  assert.ok(!existsSync(aged) && existsSync(keep), 'Original 14-day archive retention only');
  const busy = build('busy', candidate, { FIXTURE_LOCK_BUSY: '1' });
  assert.equal(busy.result.status, 0); assert.deepEqual(readdirSync(busy.backups), [], 'Busy backup lock exits without archive');

  // Production root/path guards remain mandatory. Test harness replaces only OS
  // ownership/lock boundaries inside this owned temporary filesystem; no CLI bypass.
  const harness = String.raw`
import contextlib, hashlib, importlib.util, os, pathlib, stat, sys, types
from unittest.mock import patch
sys.dont_write_bytecode = True
spec=importlib.util.spec_from_file_location('builder_install',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
base=pathlib.Path(sys.argv[2]); base.mkdir()
old=pathlib.Path(sys.argv[3]).read_bytes(); new=pathlib.Path(sys.argv[4]).read_bytes(); helper=pathlib.Path(sys.argv[5]).read_bytes()
assert m.digest(old)==m.OLD_SHA and m.digest(new)==m.BUILDER_SHA and m.digest(helper)==m.HELPER_SHA
real_trusted=m.trusted
fake=types.SimpleNamespace(st_mode=stat.S_IFREG|0o700,st_uid=0,st_file_attributes=0)
def info(path):
    return fake if pathlib.Path(path).name=='guard.py' else types.SimpleNamespace(st_mode=stat.S_IFDIR|0o755,st_uid=0,st_file_attributes=0)
guard=pathlib.Path(os.path.abspath('guard.py'))
for field,value in [('st_uid',1),('st_mode',stat.S_IFREG|0o722),('st_mode',stat.S_IFLNK|0o777),('st_file_attributes',1024)]:
    saved=getattr(fake,field); setattr(fake,field,value)
    with patch.object(pathlib.Path,'lstat',info):
        try: real_trusted(guard); raise AssertionError('unsafe guard accepted')
        except ValueError: pass
    setattr(fake,field,saved)
# Exercise the real lock context manager against a completely synthetic OS;
# even lstat is mocked, so no real scheduler/lock/service path is consulted.
real_lock=m.backup_lock
for case in ('valid','alias_target','alias_uid','sticky_mode','parent_uid','file_mode','file_uid','hardlink','nonempty','inode','opened_mode','busy'):
    alias=types.SimpleNamespace(st_mode=stat.S_IFLNK|0o777,st_uid=0)
    directory=types.SimpleNamespace(st_mode=stat.S_IFDIR|0o1777,st_uid=0)
    inode=types.SimpleNamespace(st_mode=stat.S_IFREG|0o600,st_uid=0,st_nlink=1,st_size=0,st_dev=1,st_ino=11)
    if case=='alias_uid': alias.st_uid=1
    if case=='sticky_mode': directory.st_mode=stat.S_IFDIR|0o777
    if case=='parent_uid': directory.st_uid=1
    if case=='file_mode': inode.st_mode=stat.S_IFREG|0o666
    if case=='file_uid': inode.st_uid=1
    if case=='hardlink': inode.st_nlink=2
    if case=='nonempty': inode.st_size=1
    opened=types.SimpleNamespace(**vars(inode))
    if case=='inode': opened.st_ino=12
    if case=='opened_mode': opened.st_mode=stat.S_IFREG|0o666
    opened_fds=[]; closed=[]; flocked=[]; slept=[]
    def lock_stat(p):
        return alias if p==pathlib.Path('/var/lock') else directory if p==pathlib.Path('/run/lock') else inode
    def lock_open(p,flags):
        assert pathlib.Path(p)==m.LOCK and flags & m.os.O_NOFOLLOW
        opened_fds.append(91); return 91
    def flock(fd,flags):
        flocked.append(fd)
        if case=='busy': raise BlockingIOError()
    clock=iter((0,1,6))
    m.trusted=lambda *args:None
    with contextlib.ExitStack() as stack:
        stack.enter_context(patch.dict(sys.modules,{'fcntl':types.SimpleNamespace(flock=flock,LOCK_EX=2,LOCK_NB=4)}))
        for obj,key,value in [(pathlib.Path,'lstat',lock_stat),(m.os,'readlink',lambda p:'/tmp' if case=='alias_target' else '/run/lock'),(m.os,'open',lock_open),(m.os,'close',lambda fd:closed.append(fd)),(m.os,'fstat',lambda fd:opened),(m.time,'monotonic',lambda:next(clock)),(m.time,'sleep',lambda delay:slept.append(delay))]:
            stack.enter_context(patch.object(obj,key,value))
        stack.enter_context(patch.object(m.os,'O_NOFOLLOW',0x20000,create=True)); stack.enter_context(patch.object(m.os,'O_CLOEXEC',0x80000,create=True))
        try:
            with real_lock(): assert case=='valid'
            assert case=='valid'
        except ValueError:
            assert case!='valid'
    assert closed==opened_fds
    if case=='valid': assert flocked==[91]
    if case=='busy': assert slept==[0.05] and len(flocked)==2
def trusted(path,kind='file'):
    path=pathlib.Path(path); assert path.is_absolute() and base in path.parents or path==base
    for p in [path,*path.parents]:
        x=p.lstat()
        if stat.S_ISLNK(x.st_mode) or getattr(x,'st_file_attributes',0)&1024: raise ValueError('alias_rejected')
        if p==base: break
    x=path.lstat()
    if not (stat.S_ISDIR(x.st_mode) if kind=='dir' else stat.S_ISREG(x.st_mode)): raise ValueError('type_rejected')
    return x
m.trusted=trusted; m.require_root=lambda:None; m.secure_created=lambda p,mode:os.chmod(p,mode); m.sync_dir=lambda p:None
@contextlib.contextmanager
def lock(): yield
m.backup_lock=lock
real_read=m.read_checked
m.read_checked=lambda p,expected=None,installed=False:real_read(p,expected,installed and os.name!='nt')
def statecheck(p):
    p=pathlib.Path(p); assert p.parent==m.STATE_ROOT and p.name=='ci-'+'a'*40+'-1-1'; trusted(p,'dir'); return p
m.release_state=statecheck
def setup(name):
    root=base/name; root.mkdir(); m.TARGET=root/'sbin'/'builder'; m.TARGET.parent.mkdir()
    m.HELPER=root/'lib'/'runtime'/'helper.py'; m.HELPER.parent.parent.mkdir()
    m.STATE_ROOT=root/'states'; m.STATE_ROOT.mkdir(); state=m.STATE_ROOT/('ci-'+'a'*40+'-1-1'); state.mkdir(mode=0o700)
    m.TARGET.write_bytes(old); m.TARGET.chmod(0o700)
    candidate=root/'candidate'; candidate.write_bytes(new); hp=root/'candidate-helper'; hp.write_bytes(helper)
    return root,state,candidate,hp
def rejected(call):
    try: call()
    except (ValueError,OSError): return
    raise AssertionError('guarded operation accepted')
root,state,cp,hp=setup('success'); rejected(lambda:m.rollback(state))
order=[]; replace=m.replace_checked
def observe(path,*args): order.append(path); return replace(path,*args)
m.replace_checked=observe
assert m.install(cp,hp,state)['status']=='INSTALLED'; assert order[:2]==[m.HELPER,m.TARGET]
assert m.install(cp,hp,state)['status']=='UNCHANGED'
unknown=m.HELPER.parent/'unknown'; unknown.write_bytes(b'preserve')
assert m.rollback(state)['status']=='ROLLED_BACK'; assert m.TARGET.read_bytes()==old and not m.HELPER.exists() and unknown.read_bytes()==b'preserve'
assert m.rollback(state)['status']=='ROLLED_BACK'
m.replace_checked=replace
root,state,cp,hp=setup('failure'); original_replace=m.replace_checked; once=[True]
def fail(path,*args):
    if path==m.TARGET and once[0]: once[0]=False; raise OSError('fixture injected install failure')
    return original_replace(path,*args)
m.replace_checked=fail
rejected(lambda:m.install(cp,hp,state)); assert m.TARGET.read_bytes()==old and not m.HELPER.parent.exists()
m.replace_checked=original_replace
assert m.install(cp,hp,state)['status']=='INSTALLED'; m.rollback(state); assert m.TARGET.read_bytes()==old and not m.HELPER.parent.exists()
root,state,cp,hp=setup('drift'); m.TARGET.write_bytes(b'unknown'); rejected(lambda:m.install(cp,hp,state)); assert m.TARGET.read_bytes()==b'unknown' and not (state/m.ARTIFACT).exists()
m.TARGET.write_bytes(old); cp.write_bytes(b'unknown candidate'); rejected(lambda:m.install(cp,hp,state)); assert m.TARGET.read_bytes()==old
cp.write_bytes(new); m.install(cp,hp,state); m.TARGET.write_bytes(b'changed after install'); rejected(lambda:m.rollback(state)); assert m.TARGET.read_bytes()==b'changed after install' and m.HELPER.read_bytes()==helper
root,state,cp,hp=setup('existing-helper'); m.HELPER.parent.mkdir(); m.HELPER.write_bytes(helper); m.HELPER.chmod(0o700)
m.install(cp,hp,state); m.rollback(state); assert m.HELPER.read_bytes()==helper and m.TARGET.read_bytes()==old
print('PASS installer guards, helper-first, idempotence, failure rollback, drift, retained unknown contents')
`;
  const installCheck = runPython(['-c', harness, join(ops, 'backup-builder-install.py'), join(temp, 'installer'), join(ops, 'backup-builder-before.fixture.sh'), join(ops, 'backup-builder.sh'), join(ops, 'backup-runtime-media.py')]);
  assert.equal(installCheck.status, 0, 'Installer fixture: ' + installCheck.stderr);
  console.log('PASS backup builder: exact baseline and five-member preservation; six-member manifest proof; real tar/WebP/envelope/full decode; failure/duplicate/retention/lock; installer guards and rollback');
} finally {
  assert.equal(realpathSync(temp), tempIdentity);
  assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
  assert.ok(tempIdentity.includes('cats-builder-test-'));
  rmSync(temp, { recursive: true, force: true });
}
