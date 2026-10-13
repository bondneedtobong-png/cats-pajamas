import { generateKeyPairSync, createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from './backup-envelope.mjs';
const temp = mkdtempSync(join(tmpdir(), 'cats-envelope-test-'));
try {
  const pair = generateKeyPairSync('rsa', { modulusLength: 4096, publicKeyEncoding: { type:'spki', format:'pem' }, privateKeyEncoding: { type:'pkcs8', format:'pem' } });
  const pub=join(temp,'public.pem'), priv=join(temp,'private.pem'), source=join(temp,'source'), enc=join(temp,'encrypted'), folder=join(temp,'output');
  mkdirSync(folder); writeFileSync(pub,pair.publicKey); writeFileSync(priv,pair.privateKey,{mode:0o600});
  const bytes=randomBytes(4097), hash=createHash('sha256').update(bytes).digest('hex'), name='20261013-033000.tar.gz';
  writeFileSync(source,bytes); encrypt(source,enc,pub,hash,name);
  assert.throws(()=>encrypt(source,join(temp,'wronghash'),pub,'0'.repeat(64),name));
  assert.throws(()=>encrypt(source,join(temp,'badname'),pub,hash,'../escape.tar.gz'));
  const valid=readFileSync(enc), headerSize=valid.readUInt32BE(8), offset=12+headerSize;
  for (const index of [offset+4,valid.length-1,25,12+headerSize-5]) {
    const corrupt=Buffer.from(valid); corrupt[index]^=1; const file=join(temp,`corrupt-${index}`); writeFileSync(file,corrupt);
    assert.throws(()=>decrypt(file,folder,priv)); assert.deepEqual(readdirSync(folder),[]);
  }
  const malicious=Buffer.from(valid); const header=JSON.parse(malicious.subarray(12,offset)); header.archive='../escape.tar.gz';
  const changed=Buffer.from(JSON.stringify(header)), len=Buffer.alloc(4); len.writeUInt32BE(changed.length);
  const badname=join(temp,'badmetadata'); writeFileSync(badname,Buffer.concat([valid.subarray(0,8),len,changed,valid.subarray(offset)]));
  assert.throws(()=>decrypt(badname,folder,priv));
  const badkey=join(temp,'badkey'); writeFileSync(badkey,'not a key'); assert.throws(()=>decrypt(enc,folder,badkey));
  assert.throws(()=>decrypt(enc,folder + '/../../output',priv));
  decrypt(enc,folder,priv); assert.deepEqual(readFileSync(join(folder,name)),bytes);
  assert.equal(decrypt(enc,folder,priv).existing,true);
  writeFileSync(join(folder,name),'previous backup'); assert.throws(()=>decrypt(enc,folder,priv)); assert.equal(readFileSync(join(folder,name),'utf8'),'previous backup');
  assert.deepEqual(readdirSync(folder),[name]);
  console.log('PASS: roundtrip, corrupted ciphertext/tag/AAD/header, invalid name/key/hash/path, existing archive preservation, no partials');
} finally {
  assert.ok(resolve(temp).startsWith(resolve(tmpdir())) && temp.includes('cats-envelope-test-'));
  rmSync(temp,{recursive:true,force:true});
}
