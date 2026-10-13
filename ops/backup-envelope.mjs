import { constants, createCipheriv, createDecipheriv, createHash, publicEncrypt, privateDecrypt, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, statSync, lstatSync, realpathSync, existsSync, linkSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname, parse } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX = 512 * 1024 * 1024;
const MAGIC = Buffer.from('CPBK001\n');
const sha = data => createHash('sha256').update(data).digest('hex');
function nameCheck(name) {
  if (typeof name !== 'string' || !/^\d{8}-\d{6}\.tar\.gz$/.test(name)) throw new Error('Invalid archive name');
  const digits = name.slice(0, 15);
  const iso = `${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}T${digits.slice(9,11)}:${digits.slice(11,13)}:${digits.slice(13,15)}.000Z`;
  const date = new Date(iso);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== iso) throw new Error('Invalid archive date');
}
function readBounded(path, max = MAX) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) throw new Error('Invalid input file');
  const data = readFileSync(path);
  if (data.length !== stat.size || data.length > max) throw new Error('Input changed during read');
  return data;
}
function folderCheck(folder) {
  const full = resolve(folder);
  if (full !== folder || full === parse(full).root || !statSync(full).isDirectory()) throw new Error('Invalid destination folder');
  let cursor = full;
  while (cursor !== parse(cursor).root) {
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('Destination aliases are forbidden');
    cursor = dirname(cursor);
  }
  if (realpathSync(full).toLowerCase() !== full.toLowerCase()) throw new Error('Destination aliases are forbidden');
  return full;
}
export function encrypt(source, output, publicPem, expectedSha, archive) {
  nameCheck(archive);
  if (!/^[a-f0-9]{64}$/.test(expectedSha)) throw new Error('Invalid expected hash');
  const plain = readBounded(source);
  if (sha(plain) !== expectedSha) throw new Error('Source checksum mismatch');
  const key = randomBytes(32), nonce = randomBytes(12);
  const wrapped = publicEncrypt({ key: readBounded(publicPem, 16384), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
  if (wrapped.length !== 512) throw new Error('Recipient key must be RSA 4096');
  const header = Buffer.from(JSON.stringify({ version: 1, archive, sha256: expectedSha, size: plain.length, nonce: nonce.toString('base64'), wrappedKey: wrapped.toString('base64') }));
  const size = Buffer.alloc(4); size.writeUInt32BE(header.length);
  const aad = Buffer.concat([MAGIC, size, header]);
  const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  key.fill(0);
  writeFileSync(output, Buffer.concat([aad, ciphertext, cipher.getAuthTag()]), { flag: 'wx', mode: 0o600 });
  return { archive, sha256: expectedSha, size: plain.length };
}
export function decrypt(input, folder, privatePem) {
  const destination = folderCheck(folder);
  const envelope = readBounded(input, MAX + 16384);
  if (envelope.length < 28 || !envelope.subarray(0,8).equals(MAGIC)) throw new Error('Invalid envelope');
  const headerSize = envelope.readUInt32BE(8);
  if (headerSize < 1 || headerSize > 8192 || 12 + headerSize + 16 > envelope.length) throw new Error('Invalid envelope header');
  const offset = 12 + headerSize;
  const meta = JSON.parse(envelope.subarray(12, offset).toString('utf8'));
  nameCheck(meta.archive);
  if (meta.version !== 1 || !/^[a-f0-9]{64}$/.test(meta.sha256) || !Number.isSafeInteger(meta.size) || meta.size < 0 || meta.size > MAX || envelope.length - offset - 16 !== meta.size) throw new Error('Invalid metadata');
  if (typeof meta.nonce !== 'string' || typeof meta.wrappedKey !== 'string') throw new Error('Invalid key metadata');
  const nonce = Buffer.from(meta.nonce, 'base64'), wrapped = Buffer.from(meta.wrappedKey, 'base64');
  if (nonce.length !== 12 || wrapped.length !== 512 || nonce.toString('base64') !== meta.nonce || wrapped.toString('base64') !== meta.wrappedKey) throw new Error('Invalid key encoding');
  const key = privateDecrypt({ key: readBounded(privatePem, 16384), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, wrapped);
  if (key.length !== 32) throw new Error('Invalid content key');
  const cipher = createDecipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(envelope.subarray(0, offset)); cipher.setAuthTag(envelope.subarray(-16));
  const plain = Buffer.concat([cipher.update(envelope.subarray(offset, -16)), cipher.final()]);
  key.fill(0);
  if (sha(plain) !== meta.sha256) throw new Error('Decrypted checksum mismatch');
  const target = join(destination, meta.archive);
  if (existsSync(target)) {
    if (sha(readBounded(target)) !== meta.sha256) throw new Error('Existing backup differs; preserving it');
    return { archive: meta.archive, sha256: meta.sha256, size: meta.size, existing: true };
  }
  const partial = join(destination, `${meta.archive}.${randomBytes(16).toString('hex')}.partial`);
  try {
    writeFileSync(partial, plain, { flag: 'wx', mode: 0o600 });
    // Atomic, exclusive publication on the same filesystem. Unlike rename, this
    // cannot replace an archive created concurrently between check and publish.
    linkSync(partial, target);
  } finally { if (existsSync(partial)) unlinkSync(partial); }
  return { archive: meta.archive, sha256: meta.sha256, size: meta.size, existing: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if ((mode === 'encrypt' && args.length !== 5) || (mode === 'decrypt' && args.length !== 3) || !['encrypt','decrypt'].includes(mode)) throw new Error('Invalid arguments');
    const result = mode === 'encrypt' ? encrypt(...args) : decrypt(...args);
    console.log(JSON.stringify({ ok: true, ...result }));
  } catch { console.error('Backup envelope operation failed; no verified archive published.'); process.exitCode = 1; }
}
