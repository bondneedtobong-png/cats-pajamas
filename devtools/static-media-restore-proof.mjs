import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import sharp from 'sharp';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const commit=process.argv[2] || 'e361554e2fdaf759a4d5efeed02e024b990aea13';
assert.match(commit,/^[a-f0-9]{40}$/);
const output=process.argv[3];
assert(output && path.isAbsolute(output),'Absolute report path required');
const git=(...args)=>execFileSync('git',args,{cwd:repo,maxBuffer:32*1024*1024});
assert.equal(git('cat-file','-t',commit).toString().trim(),'commit');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const rows=git('ls-tree','-r','-z',commit).toString().split('\0').filter(Boolean).map(row=>{
  const [meta,name]=row.split('\t'); const [mode,type,blob]=meta.split(' ');return {mode,type,blob,name};
});
const groups=['team','showcase-web','cocktails-web'];
const manifests=['src/data/galleryPhotos.generated.json','src/data/cocktailPhotos.generated.json'];
const script='scripts/generate-gallery-manifest.mjs';
const selected=rows.filter(row=>groups.some(group=>row.name.startsWith('public/uploads/'+group+'/')) || manifests.includes(row.name) || row.name===script);
assert(selected.length>3);
const tempRoot=await realpath(os.tmpdir());
const fixture=await mkdtemp(path.join(tempRoot,'cats-static-media-proof-'));
const proof={commit,scope:'Tracked published team/showcase-web/cocktails-web assets only; excludes runtime event photos and ignored originals.',groups:{},manifests:[],fallback:{},pass:false};
try {
  for(const row of selected){
    assert.equal(row.mode,'100644');assert.equal(row.type,'blob');
    const target=path.resolve(fixture,...row.name.split('/'));
    assert(target.startsWith(fixture+path.sep));
    const bytes=git('cat-file','blob',row.blob);
    await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);
    const restored=await readFile(target);
    assert.equal(sha(restored),sha(git('cat-file','blob',row.blob)));
    assert.equal(execFileSync('git',['hash-object','--stdin'],{cwd:repo,input:restored}).toString().trim(),row.blob);
  }
  for(const group of groups){
    const images=selected.filter(row=>row.name.startsWith('public/uploads/'+group+'/'));
    let bytes=0;const hashes=[];
    for(const row of images){
      const restored=await readFile(path.join(fixture,row.name));bytes+=restored.length;
      const decoded=await sharp(restored,{failOn:'error'}).raw().toBuffer({resolveWithObject:true});
      assert(decoded.info.width>0 && decoded.info.height>0 && decoded.data.length>0);
      hashes.push(row.name+'\0'+sha(restored)+'\n');
    }
    proof.groups[group]={files:images.length,bytes,allGitBlobAndSha256Matches:true,allDecoded:true,contentManifestSha256:sha(hashes.sort().join(''))};
  }
  const before=new Map();
  for(const name of manifests){
    const bytes=await readFile(path.join(fixture,name));before.set(name,sha(bytes));
    const data=JSON.parse(bytes);let references=0;
    for(const image of data.photos) for(const key of ['src','srcSm']){
      assert.match(image[key],/^\/uploads\/(showcase-web|cocktails-web)\//);
      const relative='public'+image[key];assert(selected.some(row=>row.name===relative));await access(path.join(fixture,relative));references++;
    }
    proof.manifests.push({path:name,photos:data.photos.length,references,allReferencesRestored:true});
  }
  for(const group of ['showcase','cocktails']){
    let exists=true;try{await access(path.join(fixture,'public/uploads',group));}catch{exists=false;}assert.equal(exists,false);
  }
  // Resolve only the installed Sharp module; the actual committed generator stays unchanged.
  const sharpUrl=pathToFileURL(createRequire(import.meta.url).resolve('sharp')).href;
  const loader=path.join(fixture,'sharp-loader.mjs');
  await writeFile(loader,`export async function resolve(specifier,context,nextResolve){if(specifier==='sharp')return {url:${JSON.stringify(sharpUrl)},shortCircuit:true};return nextResolve(specifier,context);}\n`);
  const run=execFileSync(process.execPath,['--no-warnings','--experimental-loader',pathToFileURL(loader).href,path.join(fixture,script)],{cwd:fixture,encoding:'utf8',timeout:30000});
  for(const name of manifests)assert.equal(sha(await readFile(path.join(fixture,name))),before.get(name));
  for(const row of selected.filter(row=>row.name.startsWith('public/uploads/')))assert.equal(sha(await readFile(path.join(fixture,row.name))),sha(git('cat-file','blob',row.blob)));
  proof.fallback={committedGeneratorExecuted:true,ignoredOriginalDirectoriesAbsent:true,manifestsByteIdentical:true,staticAssetsByteIdentical:true,keptManifestMessages:run.split('\n').filter(line=>line.includes('оставляю собранный манифест')).length};
  assert.equal(proof.fallback.keptManifestMessages,2);proof.pass=true;
} finally {
  const owned=await realpath(fixture);
  assert.equal(path.dirname(owned),tempRoot);assert(path.basename(owned).startsWith('cats-static-media-proof-'));assert.equal(owned,fixture);
  if(process.platform==='win32'){
    const literal=owned.replaceAll("'","''");
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Remove-Item -LiteralPath '${literal}' -Recurse -Force -ErrorAction Stop`],{stdio:'pipe'});
  } else {
    const {rm}=await import('node:fs/promises');await rm(owned,{recursive:true,force:false});
  }
  proof.ownedFixtureCleaned=true;
}
assert(proof.pass);await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({pass:proof.pass,commit,decodedImages:Object.values(proof.groups).reduce((n,g)=>n+g.files,0),manifestReferences:proof.manifests.reduce((n,m)=>n+m.references,0),fallbackPreserved:true,ownedFixtureCleaned:true}));
