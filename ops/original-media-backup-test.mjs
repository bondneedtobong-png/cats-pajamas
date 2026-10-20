/** Small synthetic images/keys only. Never uses production paths or credentials. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createSnapshot, verifySnapshot } from './original-media-backup.mjs';
import { decrypt, encrypt } from './backup-envelope.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const python=process.platform==='win32'?'python.exe':'python3';
const tempParent=fs.realpathSync(os.tmpdir());
const root=fs.mkdtempSync(path.join(tempParent,'cats-originals-fixture-'));
const counts={showcase:1,cocktails:1};
const sentinel='SYNTHETIC_PRIVATE_SENTINEL';
try {
  const repo=path.join(root,'repo'),outputRoot=path.join(root,'output');
  fs.mkdirSync(outputRoot,{mode:0o700});
  const showcase=path.join(repo,'public','uploads','showcase'),cocktails=path.join(repo,'public','uploads','cocktails');
  fs.mkdirSync(showcase,{recursive:true});fs.mkdirSync(cocktails);
  const image=await sharp({create:{width:11,height:7,channels:3,background:'#badcab'}}).jpeg().toBuffer();
  fs.writeFileSync(path.join(showcase,sentinel+'.jpg'),image);fs.writeFileSync(path.join(cocktails,'fixture.jpg'),image);
  fs.writeFileSync(path.join(repo,'.env'),sentinel);
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:4096,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const publicPem=path.join(root,'public.pem'),privatePem=path.join(root,'private.pem');
  fs.writeFileSync(publicPem,publicKey);fs.writeFileSync(privatePem,privateKey,{mode:0o600});
  const preserve=path.join(outputRoot,'preexisting');fs.writeFileSync(preserve,sentinel);
  const options={repo,outputRoot,publicPem,privatePem,python,counts};
  const created=await createSnapshot(options);
  assert.equal(created.report.files,2);assert.equal(created.report.bytes,image.length*2);assert.equal(created.report.fullDecode,true);
  assert.equal(sha(fs.readFileSync(created.ciphertext)),created.report.cipherSha256);
  assert.equal(sha(fs.readFileSync(path.join(created.directory,'originals-manifest.json'))),created.report.manifestSha256);
  assert.deepEqual(fs.readdirSync(created.directory).sort(),['originals-manifest.json','originals.enc','receipt.json']);
  assert(!JSON.stringify(created.report).includes(sentinel));assert(!JSON.stringify(created.report).includes(root));assert(!JSON.stringify(created.report).includes('PRIVATE KEY'));
  const verify={ciphertext:created.ciphertext,outputRoot,privatePem,python,counts,cipherSha256:created.report.cipherSha256,manifestSha256:created.report.manifestSha256};
  assert.equal((await verifySnapshot(verify)).files,2);
  assert.equal((await verifySnapshot({...verify,maxExpandedBytes:16384})).files,2);
  const existingEntries=fs.readdirSync(outputRoot).sort();
  const corrupt=path.join(root,'corrupt.enc'),bytes=fs.readFileSync(created.ciphertext);bytes[bytes.length-1]^=1;fs.writeFileSync(corrupt,bytes);
  await assert.rejects(verifySnapshot({...verify,ciphertext:corrupt,cipherSha256:sha(bytes)}));
  await assert.rejects(verifySnapshot({...verify,manifestSha256:'0'.repeat(64)}));
  assert.deepEqual(fs.readdirSync(outputRoot).sort(),existingEntries);

  // Crypto-valid extra member must be rejected before any unsafe extraction.
  const edit=path.join(root,'edit');fs.mkdirSync(edit);
  const meta=decrypt(created.ciphertext,edit,privatePem);
  const plain=path.join(edit,meta.archive),extra=path.join(edit,'extra.tar.gz');
  execFileSync(python,['-I','-B','-c',String.raw`
import io,sys,tarfile
with tarfile.open(sys.argv[1],'r:gz') as original,tarfile.open(sys.argv[2],'x:gz') as output:
 for member in original:output.addfile(member,original.extractfile(member))
 extra=tarfile.TarInfo('unknown.env');extra.size=1;output.addfile(extra,io.BytesIO(b'x'))
`,plain,extra],{windowsHide:true,stdio:'pipe',shell:false});
  const extraCipher=path.join(edit,'extra.enc');encrypt(extra,extraCipher,publicPem,sha(fs.readFileSync(extra)),meta.archive);
  await assert.rejects(verifySnapshot({...verify,ciphertext:extraCipher,cipherSha256:sha(fs.readFileSync(extraCipher))}));

  // Hidden headers count toward the cap; tar EOF cannot hide a second payload.
  const hidden=path.join(edit,'hidden.tar.gz'),trailing=path.join(edit,'trailing.tar.gz');
  execFileSync(python,['-I','-B','-c',String.raw`
import gzip,io,sys,tarfile
with tarfile.open(sys.argv[1],'r:gz') as original,tarfile.open(sys.argv[2],'x:gz',pax_headers={'comment':'x'*32768}) as output:
 for member in original:output.addfile(member,original.extractfile(member))
with gzip.open(sys.argv[1],'rb') as original,gzip.open(sys.argv[3],'xb') as output:
 output.write(original.read());output.write(b'NONZERO_SECOND_PAYLOAD')
`,plain,hidden,trailing],{windowsHide:true,stdio:'pipe',shell:false});
  for (const [candidate,cap] of [[hidden,16384],[trailing,512*1024*1024]]) {
    const encrypted=candidate+'.enc';encrypt(candidate,encrypted,publicPem,sha(fs.readFileSync(candidate)),meta.archive);
    await assert.rejects(verifySnapshot({...verify,ciphertext:encrypted,cipherSha256:sha(fs.readFileSync(encrypted)),maxExpandedBytes:cap}),error=>candidate!==hidden || error.code==='expanded_size_limit');
  }

  fs.writeFileSync(path.join(showcase,'unexpected.env'),sentinel);
  await assert.rejects(createSnapshot(options));fs.unlinkSync(path.join(showcase,'unexpected.env'));
  const original=path.join(showcase,sentinel+'.jpg');
  const savedOriginal=path.join(root,'saved-original.jpg');fs.renameSync(original,savedOriginal);
  const sparse=fs.openSync(original,'wx');fs.ftruncateSync(sparse,512*1024*1024+1);fs.closeSync(sparse);
  assert.equal(fs.readdirSync(showcase).length,1);
  await assert.rejects(createSnapshot(options),error=>error.code==='input_size_limit');fs.unlinkSync(original);fs.renameSync(savedOriginal,original);
  const moved=path.join(root,'moved-showcase');fs.renameSync(showcase,moved);
  fs.symlinkSync(moved,showcase,process.platform==='win32'?'junction':'dir');
  await assert.rejects(createSnapshot(options));fs.unlinkSync(showcase);fs.renameSync(moved,showcase);
  assert.deepEqual(fs.readdirSync(outputRoot).sort(),existingEntries);
  assert.equal(fs.readFileSync(preserve,'utf8'),sentinel);
  assert.equal(sha(fs.readFileSync(original)),sha(image));

  // CLI catches child-process payloads/paths and never prints private diagnostics.
  const script=fileURLToPath(new URL('./original-media-backup.mjs',import.meta.url));
  const cli=spawnSync(process.execPath,[script,'verify',corrupt,outputRoot,privatePem,sha(bytes),verify.manifestSha256,python],{encoding:'utf8',windowsHide:true,shell:false});
  assert.equal(cli.status,1);
  assert(!String(cli.stdout+cli.stderr).includes(root));assert(!String(cli.stdout+cli.stderr).includes(sentinel));assert(!String(cli.stdout+cli.stderr).includes('PRIVATE KEY'));
  console.log('PASS original snapshots: encrypted roundtrip, exact files/hash/bytes, full Sharp decode, tamper/manifest/extra-member/reparse rejection, explicit input/whole-gzip bounds including hidden headers, trailing payload rejection, existing data preserved, private diagnostics redacted.');
} finally {
  const resolved=fs.realpathSync(root);
  assert.equal(path.dirname(resolved),tempParent);assert(path.basename(resolved).startsWith('cats-originals-fixture-'));assert.equal(resolved.toLowerCase(),root.toLowerCase());
  fs.rmSync(resolved,{recursive:true,force:false});
}
