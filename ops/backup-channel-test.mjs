import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { publish, exportLatest, archiveDate, directory } from './backup-channel.mjs';
import { decrypt } from './backup-envelope.mjs';
// Fixture subprocesses need Git's gzip/GNU tar on Windows; never change host settings.
if (process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/gzip.exe')) process.env.PATH = `C:\\Program Files\\Git\\usr\\bin;${process.env.PATH}`;
const temp = mkdtempSync(join(tmpdir(), 'cats-channel-test-'));
try {
  const source=join(temp,'source'), spool=join(temp,'spool'), output=join(temp,'output');
  for(const dir of [source,spool,output]) mkdirSync(dir);
  const pair=generateKeyPairSync('rsa',{modulusLength:4096,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const pub=join(temp,'public.pem'), priv=join(temp,'private.pem');
  writeFileSync(pub,pair.publicKey); writeFileSync(priv,pair.privateKey);
  const now=Date.parse('2026-10-14T04:15:00Z'), name='20261014-033000.tar.gz';
  const bytes=gzipSync(Buffer.alloc(1024)); writeFileSync(join(source,name),bytes);
  const result=publish(source,spool,pub,now);
  assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.ok(exportLatest(spool,'export-latest',now).length > bytes.length);
  for(const command of [undefined,'','id','export-latest x','export-latest\n','scp -f /etc/passwd']) assert.throws(()=>exportLatest(spool,command,now));
  process.env.SSH_TTY='/dev/pts/1'; assert.throws(()=>exportLatest(spool,'export-latest',now)); delete process.env.SSH_TTY;
  decrypt(join(spool,'latest.enc'),output,priv); assert.deepEqual(readFileSync(join(output,name)),bytes);
  assert.throws(()=>archiveDate('20261012-033000.tar.gz',now));
  assert.throws(()=>archiveDate('20260230-033000.tar.gz',now));
  assert.throws(()=>exportLatest(spool,'export-latest',now+37*3600000));
  const previous=readFileSync(join(spool,'latest.enc'));
  assert.throws(()=>publish(source,spool,pub,now+37*3600000));
  const corruptEnvelope=Buffer.from(previous); corruptEnvelope[corruptEnvelope.length-1]^=1;
  writeFileSync(join(temp,'corrupt.enc'),corruptEnvelope);
  assert.throws(()=>decrypt(join(temp,'corrupt.enc'),output,priv));
  writeFileSync(join(source,name),gzipSync(Buffer.alloc(2048,65)));
  assert.throws(()=>publish(source,spool,pub,now));
  writeFileSync(join(source,name),'corrupt gzip'); assert.throws(()=>publish(source,spool,pub,now));
  assert.deepEqual(readFileSync(join(spool,'latest.enc')),previous);
  assert.deepEqual(readdirSync(spool),['latest.enc']);
  // Symlink fixtures require POSIX or Windows developer mode/admin privileges.
  if(process.platform !== 'win32') {
    symlinkSync(source,join(temp,'alias')); assert.throws(()=>directory(join(temp,'alias')));
    rmSync(join(source,name)); symlinkSync(pub,join(source,name)); assert.throws(()=>publish(source,spool,pub,now));
    rmSync(join(spool,'latest.enc')); symlinkSync(pub,join(spool,'latest.enc')); assert.throws(()=>exportLatest(spool,'export-latest',now));
  }
  console.log('PASS: restricted command, freshness, gzip corruption, preserved export, envelope recovery; POSIX symlink fixtures conditional');
} finally {
  assert.ok(resolve(temp).startsWith(resolve(tmpdir())) && temp.includes('cats-channel-test-'));
  rmSync(temp,{recursive:true,force:true});
}
