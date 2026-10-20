// Synthetic loopback-free media/SQL/archive fixtures; no production files/keys.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {encrypt,decrypt} from './backup-envelope.mjs';

const python=process.platform==='win32'?'python.exe':'python3';
const helper=fileURLToPath(new URL('./backup-runtime-media.py',import.meta.url));
const parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'cats-runtime-media-fixture-'));
const secret='SYNTHETIC_RUNTIME_PRIVATE_SENTINEL';
const hash=b=>createHash('sha256').update(b).digest('hex');
const py=(source,args=[])=>execFileSync(python,['-I','-B','-c',source,...args],{encoding:'utf8',windowsHide:true,shell:false,stdio:'pipe',timeout:30000});
function run(args,ok=true,code) {
 const result=spawnSync(python,['-I','-B',helper,...args],{encoding:'utf8',windowsHide:true,shell:false,timeout:30000});
 assert.equal(result.status,ok?0:1,ok?String(result.stderr):'Rejected operation unexpectedly succeeded');
 assert(!String(result.stdout+result.stderr).includes(secret));assert(!String(result.stdout+result.stderr).includes(root));
 if(code)assert(String(result.stderr).includes(code));
 return ok?JSON.parse(result.stdout):result;
}
const archive=(live,target)=>py("import sys,tarfile\nwith tarfile.open(sys.argv[2],'x:gz',format=tarfile.USTAR_FORMAT) as t:t.add(sys.argv[1],arcname='cats-pajamas-uploads')",[live,target]);
const gzip=(target,text)=>py("import gzip,sys\nwith gzip.open(sys.argv[1],'xb') as f:f.write(sys.argv[2].encode())",[target,text]);
const sql=photos=>`-- ${secret}\nCOPY public.other (id, note) FROM stdin;\nx\t${secret}\\nCOPY public.events fake\n\\.\nCOPY public.events (id, image_urls, image_url, note) FROM stdin;\nev_fixture\t${JSON.stringify(photos).replaceAll('\\','\\\\')}\t\\N\t${secret}\n\\.\n`;
const local='/uploads/events/ev_fixture/0.webp';
const library=String.raw`import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('media',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
try:
 action=sys.argv[2]
 if action=='capture':result=m.capture(*sys.argv[3:7],limit=int(sys.argv[7]))
 elif action=='changed':
  original=m.inventory;calls=0
  def inventory(*args):
   global calls
   calls+=1
   if calls==2:
    with open(sys.argv[8],'ab') as f:f.write(b'changed')
   return original(*args)
  m.inventory=inventory;result=m.capture(*sys.argv[3:7],limit=int(sys.argv[7]))
 elif action=='escapes':
  assert m.copy_field(r'\N') is None
  assert m.copy_field(r'a\tb\n\101\x42\\')=='a\tb\nAB\\'
  result={'ok':True}
 print(json.dumps(result))
except Exception as e:
 print('REJECTED '+(str(e) if isinstance(e,m.Rejected) else 'invalid'));sys.exit(1)
`;
function bounded(args,code) {
 const result=spawnSync(python,['-I','-B','-c',library,helper,...args],{encoding:'utf8',windowsHide:true,shell:false,timeout:30000});
 assert.equal(result.status,1);assert(String(result.stdout).includes(code));assert(!String(result.stdout+result.stderr).includes(secret));assert(!String(result.stdout+result.stderr).includes(root));
}
try {
 const live=path.join(root,'live'),events=path.join(live,'events'),event=path.join(events,'ev_fixture');
 fs.mkdirSync(event,{recursive:true});fs.mkdirSync(path.join(live,'misc'));
 const main=await sharp({create:{width:32,height:24,channels:3,background:'#bbaacc'}}).webp().toBuffer();
 const thumb=await sharp(main).resize(8,6).webp().toBuffer();
 const mainPath=path.join(event,'0.webp'),thumbPath=path.join(event,'0.thumb.webp'),opaque=path.join(live,'misc','opaque.bin');
 fs.writeFileSync(mainPath,main);fs.writeFileSync(thumbPath,thumb);fs.writeFileSync(opaque,secret);
 const nested=path.join(root,'runtime.tar.gz'),database=path.join(root,'database.sql.gz'),manifest=path.join(root,'runtime-manifest.json');
 archive(live,nested);gzip(database,sql([local,'https://example.invalid/'+secret]));
 const captured=run(['capture',nested,live,database,manifest]);assert.equal(captured.event_pairs,1);assert.equal(captured.db_local_refs,1);assert.equal(captured.db_remote_refs_outside_scope,1);assert.equal(captured.file_count,3);
 const receipt=JSON.parse(fs.readFileSync(manifest));assert.equal(receipt.full_decode_verified,false);assert.equal(hash(fs.readFileSync(manifest)),captured.manifest_sha256);
 assert.deepEqual(run(['verify',nested,manifest]),captured);
 const originalManifest=fs.readFileSync(manifest);run(['capture',nested,live,database,manifest],false,'output_exists');assert.deepEqual(fs.readFileSync(manifest),originalManifest);
 const out=()=>path.join(root,'new-'+Math.random().toString(16).slice(2)+'.json');
 const badDb=path.join(root,'missing-ref.sql.gz');gzip(badDb,sql(['/uploads/events/ev_missing/0.webp']));run(['capture',nested,live,badDb,out()],false,'database_local_ref_missing');
 const invalidDb=path.join(root,'invalid.sql.gz');gzip(invalidDb,'COPY public.events (id, image_urls) FROM stdin;\nx\tnot-json\n\\.\n');run(['capture',nested,live,invalidDb,out()],false);
 const truncatedDb=path.join(root,'truncated.sql.gz');gzip(truncatedDb,'COPY public.events (id, image_urls) FROM stdin;\nx\t[]\n');run(['capture',nested,live,truncatedDb,out()],false,'copy_block_missing_or_truncated');
 const legacyDb=path.join(root,'legacy.sql.gz');gzip(legacyDb,'COPY public.events (id, image_url) FROM stdin;\nx\t'+local+'\n\\.\n');assert.equal(run(['capture',nested,live,legacyDb,out()]).db_local_refs,1);
 assert.equal(JSON.parse(py(library,[helper,'escapes'])).ok,true);
 fs.writeFileSync(opaque,'different');run(['capture',nested,live,database,out()],false,'archive_live_mismatch');fs.writeFileSync(opaque,secret);
 fs.unlinkSync(thumbPath);const missingPair=path.join(root,'missing-pair.tar.gz');archive(live,missingPair);run(['capture',missingPair,live,database,out()],false,'image_pair_missing');fs.writeFileSync(thumbPath,thumb);
 fs.writeFileSync(mainPath,main.subarray(0,-3));const truncated=path.join(root,'truncated.tar.gz');archive(live,truncated);run(['capture',truncated,live,database,out()],false,'webp_rejected');fs.writeFileSync(mainPath,main);
 fs.writeFileSync(path.join(event,'unknown.env'),secret);const unknown=path.join(root,'unknown.tar.gz');archive(live,unknown);run(['capture',unknown,live,database,out()],false,'event_path_rejected');fs.unlinkSync(path.join(event,'unknown.env'));
 const moved=path.join(root,'moved-events');fs.renameSync(events,moved);fs.symlinkSync(moved,events,process.platform==='win32'?'junction':'dir');run(['capture',nested,live,database,out()],false,'path_rejected');fs.unlinkSync(events);fs.renameSync(moved,events);
 const linked=path.join(root,'linked-opaque');fs.linkSync(opaque,linked);run(['capture',nested,live,database,out()],false,'path_rejected');fs.unlinkSync(linked);
 bounded(['changed',nested,live,database,out(),'16384',opaque],'live_changed');fs.writeFileSync(opaque,secret);
 // Hidden metadata expands before tarfile can see a normal member; all gzip
 // bytes must count. Tail payload and unsafe entry types are separately refused.
 for(const mode of ['pax','tail','duplicate','traversal','absolute','symlink','hardlink']) {
  const bad=path.join(root,mode+'.tar.gz');
  py(String.raw`import gzip,io,sys,tarfile
source,target,mode=sys.argv[1:]
if mode=='tail':
 with gzip.open(source,'rb') as i,gzip.open(target,'xb') as o:o.write(i.read());o.write(b'NONZERO')
else:
 with tarfile.open(source,'r:gz') as i,tarfile.open(target,'x:gz',format=tarfile.PAX_FORMAT if mode=='pax' else tarfile.USTAR_FORMAT,pax_headers={'comment':'x'*32768} if mode=='pax' else None) as o:
  members=list(i)
  for m in members:o.addfile(m,i.extractfile(m) if m.isfile() else None)
  if mode!='pax':
   name={'duplicate':members[-1].name,'traversal':'../bad','absolute':'/bad','symlink':'cats-pajamas-uploads/link','hardlink':'cats-pajamas-uploads/hard'}[mode]
   m=tarfile.TarInfo(name)
   if mode in ('symlink','hardlink'):m.type=tarfile.SYMTYPE if mode=='symlink' else tarfile.LNKTYPE;m.linkname='outside'
   else:m.size=1
   o.addfile(m,None if mode in ('symlink','hardlink') else io.BytesIO(b'x'))
`,[nested,bad,mode]);
  if(mode==='pax')bounded(['capture',bad,live,database,out(),'16384'],'expanded_size_limit');
  else run(['capture',bad,live,database,out()],false);
 }
 const bomb=path.join(root,'bomb.sql.gz');gzip(bomb,'x'.repeat(16385));bounded(['capture',nested,live,bomb,out(),'16384'],'expanded_size_limit');
 const empty=path.join(root,'empty-live');fs.mkdirSync(path.join(empty,'events'),{recursive:true});const emptyTar=path.join(root,'empty.tar.gz'),emptyDb=path.join(root,'empty.sql.gz');archive(empty,emptyTar);gzip(emptyDb,'COPY public.events (id, image_urls) FROM stdin;\n\\.\n');const emptyReport=run(['capture',emptyTar,empty,emptyDb,out()]);assert.equal(emptyReport.source_empty,true);assert.equal(emptyReport.event_files,0);assert.equal(emptyReport.db_local_refs,0);

 // Build the exact outer six-member format; config bytes are invalid UTF-8 to
 // prove verification does not decode/extract them. Encryption uses fixture keys.
 const outer=path.join(root,'20261020-120000.tar.gz');
 py(String.raw`import io,sys,tarfile,pathlib
with tarfile.open(sys.argv[4],'x:gz',format=tarfile.USTAR_FORMAT) as t:
 for name,source in [('runtime-uploads.tar.gz',sys.argv[1]),('database.sql.gz',sys.argv[2]),('runtime-manifest.json',sys.argv[3])]:t.add(source,arcname='./'+name)
 for name in ['app.env','supabase.env','nginx.conf']:
  data=b'\xffPRIVATE_OPAQUE_CONFIG';m=tarfile.TarInfo('./'+name);m.size=len(data);t.addfile(m,io.BytesIO(data))
`,[nested,database,manifest,outer]);
 assert.deepEqual(run(['verify-backup',outer]),captured);
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:4096,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const pub=path.join(root,'fixture-public.pem'),key=path.join(root,'fixture-private.pem'),cipher=path.join(root,'fixture.enc'),restore=path.join(root,'restore');fs.writeFileSync(pub,publicKey);fs.writeFileSync(key,privateKey,{mode:0o600});fs.mkdirSync(restore,{mode:0o700});
 encrypt(outer,cipher,pub,hash(fs.readFileSync(outer)),path.basename(outer));const decrypted=decrypt(cipher,restore,key);const restoredOuter=path.join(restore,decrypted.archive);assert.equal(hash(fs.readFileSync(restoredOuter)),decrypted.sha256);assert.deepEqual(run(['verify-backup',restoredOuter]),captured);
 // Only already-verified allowlisted image members are copied to a new owned
 // fixture root, never extractall and never any outer environment/config member.
 py(String.raw`import gzip,io,json,pathlib,sys,tarfile
outer,dest,manifest=sys.argv[1:];dest=pathlib.Path(dest)
with tarfile.open(outer,'r:gz') as t:payload=t.extractfile('./runtime-uploads.tar.gz').read()
with tarfile.open(fileobj=io.BytesIO(payload),mode='r:gz') as t:
 for row in json.load(open(manifest))['files']:
  if not row['path'].startswith('cats-pajamas-uploads/events/'):continue
  p=pathlib.PurePosixPath(row['path']);assert not p.is_absolute() and '..' not in p.parts
  target=dest.joinpath(*p.parts);target.parent.mkdir(parents=True,exist_ok=True)
  with target.open('xb') as f:f.write(t.extractfile(row['path']).read())
`,[restoredOuter,restore,manifest]);
 for(const [name,original]of [['0.webp',main],['0.thumb.webp',thumb]]) {
  const bytes=fs.readFileSync(path.join(restore,'cats-pajamas-uploads','events','ev_fixture',name));assert.equal(hash(bytes),hash(original));const decoded=await sharp(bytes,{failOn:'error'}).raw().toBuffer({resolveWithObject:true});assert(decoded.info.width&&decoded.info.height&&decoded.data.length);
 }
 const alteredManifest=path.join(root,'altered-manifest.json');const changed=structuredClone(receipt);changed.database.remote_refs_outside_scope++;fs.writeFileSync(alteredManifest,JSON.stringify(changed));
 const alteredOuter=path.join(root,'altered-outer.tar.gz');
 py(String.raw`import sys,tarfile
with tarfile.open(sys.argv[1],'r:gz') as i,tarfile.open(sys.argv[3],'x:gz',format=tarfile.USTAR_FORMAT) as o:
 for m in i:
  if m.name=='./runtime-manifest.json':o.add(sys.argv[2],arcname=m.name)
  else:o.addfile(m,i.extractfile(m) if m.isfile() else None)
`,[outer,alteredManifest,alteredOuter]);run(['verify-backup',alteredOuter],false,'database_manifest_mismatch');
 assert(!fs.readdirSync(root).some(name=>name.startsWith('.runtime-proof-')));
 console.log('PASS runtime media: exact live/archive hash parity and stable stats; canonical paths/pairs/RIFF bounds; empty and SQL COPY/legacy/local/remote refs; hidden gzip headers/tails/links/duplicates/bounds rejected; immutable manifest; encrypted isolated restore + full Sharp decode; outer six-member/SQL re-verification and redacted diagnostics.');
} finally {
 const full=fs.realpathSync(root);assert.equal(path.dirname(full),parent);assert(path.basename(full).startsWith('cats-runtime-media-fixture-'));assert.equal(full.toLowerCase(),root.toLowerCase());fs.rmSync(full,{recursive:true,force:false});
}
