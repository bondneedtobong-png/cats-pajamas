import { lstatSync, realpathSync, readdirSync, readFileSync, renameSync, unlinkSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { encrypt } from './backup-envelope.mjs';

const MAX = 512 * 1024 * 1024;
export function directory(path) {
  if (resolve(path) !== path || realpathSync(path) !== path) throw new Error('Directory alias rejected');
  let cursor = path;
  while (true) {
    const stat = lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Directory alias rejected');
    const parent = resolve(cursor, '..');
    if (parent === cursor) break;
    cursor = parent;
  }
}
export function archiveDate(name, now = Date.now()) {
  if (!/^\d{8}-\d{6}\.tar\.gz$/.test(name)) throw new Error('Invalid archive name');
  const iso = `${name.slice(0,4)}-${name.slice(4,6)}-${name.slice(6,8)}T${name.slice(9,11)}:${name.slice(11,13)}:${name.slice(13,15)}.000Z`;
  const date = new Date(iso);
  if (!Number.isFinite(+date) || date.toISOString() !== iso || now - date > 36*3600000 || +date - now > 600000) throw new Error('Archive freshness rejected');
}
export function publish(source, spool, publicKey, now = Date.now()) {
  directory(source); directory(spool);
  const names = readdirSync(source).filter(n => /^\d{8}-\d{6}\.tar\.gz$/.test(n)).sort();
  if (!names.length) throw new Error('No archive');
  const name = names.at(-1); archiveDate(name, now);
  const path = join(source, name), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX) throw new Error('Invalid archive');
  const gzip = spawnSync('gzip', ['-t', '--', path], { timeout: 120000, stdio: 'ignore' });
  if (gzip.status !== 0) throw new Error('Corrupt gzip archive');
  const tar = spawnSync('tar', ['--force-local', '-tzf', path], { timeout: 120000, stdio: 'ignore' });
  if (tar.status !== 0) throw new Error('Corrupt tar archive');
  const bytes = readFileSync(path);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const temporary = join(spool, `.envelope-${randomBytes(12).toString('hex')}.partial`);
  try {
    encrypt(path, temporary, publicKey, checksum, name);
    chmodSync(temporary, 0o640);
    renameSync(temporary, join(spool, 'latest.enc'));
  } finally { try { unlinkSync(temporary); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  return { archive: name, sha256: checksum };
}
export function exportLatest(spool, command, now = Date.now()) {
  if (command !== 'export-latest' || process.env.SSH_TTY) throw new Error('Command rejected');
  directory(spool);
  const path = join(spool, 'latest.enc'), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 28 || stat.size > MAX + 16384) throw new Error('Invalid envelope');
  const bytes = readFileSync(path);
  if (bytes.length !== stat.size || !bytes.subarray(0,8).equals(Buffer.from('CPBK001\n'))) throw new Error('Invalid envelope');
  const length = bytes.readUInt32BE(8);
  if (length < 1 || length > 8192 || 12 + length + 16 > bytes.length) throw new Error('Invalid envelope header');
  const meta = JSON.parse(bytes.subarray(12,12+length));
  archiveDate(meta.archive, now);
  if (meta.version !== 1 || !/^[a-f0-9]{64}$/.test(meta.sha256) || !Number.isSafeInteger(meta.size) || meta.size < 1 || meta.size > MAX || bytes.length !== 12+length+meta.size+16) throw new Error('Invalid envelope metadata');
  return bytes;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === 'publish' && args.length === 0) publish('/var/backups/cats-pajamas', '/var/lib/cats-backup-export', '/usr/local/lib/cats-backup/backup-recipient.pem');
    else if (mode === 'export' && args.length === 0) process.stdout.write(exportLatest('/var/lib/cats-backup-export', process.env.SSH_ORIGINAL_COMMAND));
    else throw new Error('Command rejected');
  } catch { console.error('Backup channel rejected operation'); process.exitCode = 1; }
}
