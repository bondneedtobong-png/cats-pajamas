/** Local ignored-original snapshots. No network, upload, scheduler or server access.
 * Windows PRECONDITION: caller verifies outputRoot has the existing protected
 * current-user/SYSTEM DACL. New unique directories inherit that DACL; POSIX uses
 * 0700. Keys are read only by the existing envelope helper, never archived.
 * CLI stdout contains aggregate proof only. Keep receipt + ciphertext together.
 * An independent owner-held recovery-key copy is needed for whole-PC loss.
 *
 * create REPO OUTPUT_ROOT PUBLIC_PEM PRIVATE_PEM [PYTHON]
 * verify CIPHERTEXT OUTPUT_ROOT PRIVATE_PEM CIPHER_SHA MANIFEST_SHA [PYTHON]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { encrypt, decrypt } from './backup-envelope.mjs';

const MAX = 512 * 1024 * 1024;
const DEFAULT_COUNTS = { showcase: 47, cocktails: 8 };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Fixed program, JSON protocol on stdin, shell=false. No key bytes are sent here.
const PYTHON = String.raw`
import gzip,hashlib,json,os,pathlib,re,stat,sys,tarfile
MAX=512*1024*1024
class Rejected(Exception):pass
def check(p,kind=None):
 p=pathlib.Path(p)
 if not p.is_absolute() or os.path.normpath(str(p))!=str(p): raise ValueError()
 for q in [*reversed(p.parents),p]:
  s=q.lstat()
  if stat.S_ISLNK(s.st_mode) or getattr(s,'st_file_attributes',0)&1024: raise ValueError()
 s=p.lstat()
 if kind=='file' and not stat.S_ISREG(s.st_mode): raise ValueError()
 if kind=='dir' and not stat.S_ISDIR(s.st_mode): raise ValueError()
 return s
def regular(p,limit=MAX):
 before=check(p,'file')
 if before.st_size>limit: raise Rejected('input_size_limit')
 fd=os.open(p,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
 with os.fdopen(fd,'rb') as f:
  now=os.fstat(f.fileno())
  if (now.st_ino,now.st_dev,now.st_size)!=(before.st_ino,before.st_dev,before.st_size): raise ValueError()
  data=f.read(limit+1)
 after=check(p,'file')
 if len(data)!=before.st_size or len(data)>limit or (before.st_size,before.st_mtime_ns,before.st_ino)!=(after.st_size,after.st_mtime_ns,after.st_ino): raise ValueError()
 return data
def safe_name(name):
 p=pathlib.PurePosixPath(name)
 if p.is_absolute() or '..' in p.parts or str(p)!=name or '\\' in name or ':' in name: raise ValueError()
 if len(p.parts)!=4 or p.parts[:2]!=('public','uploads') or p.parts[2] not in ('showcase','cocktails'): raise ValueError()
 if any(ord(c)<32 or c in '<>:"|?*' for c in p.name) or re.fullmatch(r'CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9]',p.name.split('.')[0],re.I): raise ValueError()
 if not p.name or p.name.endswith((' ','.')) or p.suffix.lower() not in ('.jpg','.jpeg','.png','.webp','.tif','.tiff','.avif','.heic'): raise ValueError()
 return p.parts[2]
def rows_valid(manifest,counts):
 if set(manifest)!=set(('version','scope','files','counts','bytes')) or manifest['version']!=1 or manifest['scope']!='ignored-originals': raise ValueError()
 rows=manifest['files']
 if not isinstance(rows,list) or len(rows)!=sum(counts.values()) or len(rows)>1000: raise ValueError()
 actual={key:0 for key in counts};seen=set();total=0
 for row in rows:
  if set(row)!=set(('path','bytes','sha256')): raise ValueError()
  group=safe_name(row['path']); folded=row['path'].casefold()
  if folded in seen or type(row['bytes'])!=int or row['bytes']<1 or row['bytes']>MAX: raise ValueError()
  if not isinstance(row['sha256'],str) or len(row['sha256'])!=64 or any(c not in '0123456789abcdef' for c in row['sha256']): raise ValueError()
  seen.add(folded);actual[group]+=1;total+=row['bytes']
 if actual!=counts or manifest['counts']!=counts or manifest['bytes']!=total or total>MAX: raise ValueError()
 return rows
def main(request):
 action=request['action']
 if action=='check':
  for p,kind in request['paths']: check(p,kind)
  return {}
 counts=request['counts']; target=pathlib.Path(request['target']);check(target,'dir')
 if action=='prepare':
  repo=pathlib.Path(request['repo']);check(repo,'dir');rows=[];total=0
  snapshot=target/'snapshot';snapshot.mkdir(mode=0o700)
  for group in ('showcase','cocktails'):
   source=repo/'public'/'uploads'/group;check(source,'dir')
   entries=sorted(source.iterdir(),key=lambda p:p.name)
   if len(entries)!=counts[group]: raise ValueError()
   for entry in entries:
    relative='public/uploads/'+group+'/'+entry.name;safe_name(relative)
    data=regular(entry);total+=len(data)
    if total>MAX: raise ValueError()
    dest=snapshot.joinpath(*pathlib.PurePosixPath(relative).parts);dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    with dest.open('xb') as f:f.write(data)
    rows.append({'path':relative,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
  manifest={'version':1,'scope':'ignored-originals','files':sorted(rows,key=lambda r:r['path']),'counts':counts,'bytes':total}
  rows_valid(manifest,counts)
  manifest_bytes=(json.dumps(manifest,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()
  with (target/'originals-manifest.json').open('xb') as f:f.write(manifest_bytes)
  archive=target/request['archive']
  with tarfile.open(archive,'x:gz',format=tarfile.USTAR_FORMAT) as tar:
   for name in ['originals-manifest.json']+[row['path'] for row in manifest['files']]:
    src=target/name if name=='originals-manifest.json' else snapshot.joinpath(*pathlib.PurePosixPath(name).parts)
    data=regular(src,1024*1024 if name=='originals-manifest.json' else MAX)
    info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o600
    import io
    tar.addfile(info,io.BytesIO(data))
  if check(archive,'file').st_size>MAX: raise ValueError()
  return {'manifest':manifest,'manifestSha256':hashlib.sha256(manifest_bytes).hexdigest()}
 if action=='restore':
  archive=pathlib.Path(request['archive']);check(archive,'file')
  if archive.stat().st_size>MAX: raise ValueError()
  limit=request['maxExpandedBytes']
  bounded=target/'bounded-archive.tar'
  # Bound every expanded byte, including hidden PAX/GNU headers and padding,
  # before tarfile is permitted to parse any attacker-controlled header.
  expanded=0
  with gzip.open(archive,'rb') as zipped,bounded.open('xb') as output:
   while True:
    chunk=zipped.read(min(65536,limit-expanded+1))
    if not chunk:break
    expanded+=len(chunk)
    if expanded>limit:raise Rejected('expanded_size_limit')
    output.write(chunk)
  class BoundedReader:
   def __init__(self,stream):self.stream=stream
   def read(self,size=-1):
    if size<0 or size>limit:raise ValueError()
    return self.stream.read(size)
   def __getattr__(self,name):return getattr(self.stream,name)
  with bounded.open('rb') as raw,tarfile.open(fileobj=BoundedReader(raw),mode='r:') as tar:
   members=[];expanded=0
   for member in tar:
    members.append(member);expanded+=member.size
    if len(members)>sum(counts.values())+1 or not member.isfile() or member.size<0 or expanded>MAX or member.pax_headers or member.offset_data!=member.offset+512: raise ValueError()
   names=[m.name for m in members]
   if len(names)!=len(set(names)) or names.count('originals-manifest.json')!=1: raise ValueError()
   # Standard tar readers ignore a second archive or other payload after EOF.
   # Only complete zero padding may follow the final allowlisted data block.
   end=max(m.offset_data+((m.size+511)//512)*512 for m in members)
   size=bounded.stat().st_size
   if tar.pax_headers or size%512 or size-end<1024:raise ValueError()
   raw.seek(end)
   while True:
    tail=raw.read(65536)
    if not tail:break
    if any(tail):raise ValueError()
   item=members[names.index('originals-manifest.json')]
   if item.size>1024*1024: raise ValueError()
   data=tar.extractfile(item).read(1024*1024+1)
   if hashlib.sha256(data).hexdigest()!=request['manifestSha256']: raise ValueError()
   manifest=json.loads(data);rows=rows_valid(manifest,counts)
   expected={r['path']:r for r in rows}
   if set(names)!=set(expected)|{'originals-manifest.json'}: raise ValueError()
   for member in members:
    if member.name=='originals-manifest.json':continue
    row=expected[member.name];safe_name(member.name)
    if member.size!=row['bytes']: raise ValueError()
    data=tar.extractfile(member).read(row['bytes']+1)
    if len(data)!=row['bytes'] or hashlib.sha256(data).hexdigest()!=row['sha256']:raise ValueError()
    dest=target.joinpath(*pathlib.PurePosixPath(member.name).parts);dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    check(dest.parent,'dir')
    with dest.open('xb') as f:f.write(data)
   return {'manifest':manifest}
 raise ValueError()
try:
 request=json.load(sys.stdin);print(json.dumps(main(request),ensure_ascii=True))
except Rejected as error:
 print('Original snapshot rejected:'+str(error),file=sys.stderr);sys.exit(1)
except Exception:
 print('Original snapshot operation rejected',file=sys.stderr);sys.exit(1)
`;

function pythonCall(python, request) {
  try {
    const result = execFileSync(python, ['-I', '-B', '-c', PYTHON], {
      input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 1024 * 1024,
      timeout: 180000, windowsHide: true, shell: false, stdio: ['pipe','pipe','pipe'],
    });
    return JSON.parse(result);
  } catch (error) {
    const failure=new Error('Original snapshot operation rejected');
    const label=String(error.stderr||'').trim();
    failure.code=label==='Original snapshot rejected:input_size_limit'?'input_size_limit':label==='Original snapshot rejected:expanded_size_limit'?'expanded_size_limit':'rejected';
    throw failure;
  }
}
function absolute(value) {
  if (typeof value !== 'string' || path.resolve(value) !== value || path.parse(value).root === value) throw Error('Rejected path');
  return value;
}
function check(python, paths) { pythonCall(python, { action: 'check', paths: paths.map(([p,kind]) => [absolute(p),kind]) }); }
function ownedFolder(root, prefix, python) {
  check(python, [[root,'dir']]);
  const folder = fs.mkdtempSync(path.join(root, prefix));
  if (process.platform !== 'win32') fs.chmodSync(folder, 0o700);
  check(python, [[folder,'dir']]);
  return folder;
}
function removeOwned(folder, root, prefix, python) {
  check(python, [[root,'dir'],[folder,'dir']]);
  if (path.dirname(folder) !== root || !path.basename(folder).startsWith(prefix) || fs.realpathSync(folder).toLowerCase() !== folder.toLowerCase()) throw Error('Rejected cleanup');
  fs.rmSync(folder, { recursive: true, force: false });
}
function countsCheck(counts) {
  if (Object.keys(counts).sort().join(',') !== 'cocktails,showcase' || Object.values(counts).some(v => !Number.isSafeInteger(v) || v < 1 || v > 1000) || Object.values(counts).reduce((a,b)=>a+b,0)>1000) throw Error('Rejected counts');
}
function fileSha(file) {
  const info=fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size>MAX+16384) throw Error('Rejected file');
  return sha(fs.readFileSync(file));
}

export async function verifySnapshot({ ciphertext, outputRoot, privatePem, cipherSha256, manifestSha256, python=process.platform==='win32'?'python.exe':'python3', counts=DEFAULT_COUNTS, maxExpandedBytes=MAX }) {
  countsCheck(counts);
  if (!Number.isSafeInteger(maxExpandedBytes) || maxExpandedBytes<512 || maxExpandedBytes>MAX) throw Error('Rejected expanded bound');
  if (![cipherSha256,manifestSha256].every(v=>/^[a-f0-9]{64}$/.test(v))) throw Error('Rejected proof hashes');
  check(python, [[ciphertext,'file'],[privatePem,'file'],[outputRoot,'dir']]);
  if (fileSha(ciphertext)!==cipherSha256) throw Error('Ciphertext mismatch');
  const fixture=ownedFolder(outputRoot,'originals-verify-',python);
  try {
    const decrypted=decrypt(ciphertext,fixture,privatePem);
    const restored=path.join(fixture,'restored');fs.mkdirSync(restored,{mode:0o700});
    const {manifest}=pythonCall(python,{action:'restore',archive:path.join(fixture,decrypted.archive),target:restored,manifestSha256,counts,maxExpandedBytes});
    let decoded=0;
    for (const row of manifest.files) {
      const target=path.join(restored,...row.path.split('/'));
      check(python,[[target,'file']]);
      const bytes=fs.readFileSync(target);
      if (bytes.length!==row.bytes || sha(bytes)!==row.sha256) throw Error('Image byte mismatch');
      const result=await sharp(bytes,{failOn:'error',limitInputPixels:100000000}).raw().toBuffer({resolveWithObject:true});
      if (!result.info.width || !result.info.height || !result.data.length) throw Error('Image decode failed');
      decoded++;
    }
    return {ok:true,files:decoded,bytes:manifest.bytes,counts:manifest.counts,cipherSha256,manifestSha256,archiveSha256:decrypted.sha256,fullDecode:true};
  } finally { removeOwned(fixture,outputRoot,'originals-verify-',python); }
}

export async function createSnapshot({ repo, outputRoot, publicPem, privatePem, python=process.platform==='win32'?'python.exe':'python3', counts=DEFAULT_COUNTS }) {
  countsCheck(counts);
  check(python,[[repo,'dir'],[outputRoot,'dir'],[publicPem,'file'],[privatePem,'file']]);
  const directory=ownedFolder(outputRoot,'originals-snapshot-',python);
  let complete=false;
  try {
    const archiveName=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15)+'.tar.gz';
    const prepared=pythonCall(python,{action:'prepare',repo,target:directory,archive:archiveName,counts});
    const archive=path.join(directory,archiveName),ciphertext=path.join(directory,'originals.enc');
    const archiveSha256=fileSha(archive);
    encrypt(archive,ciphertext,publicPem,archiveSha256,archiveName);
    const cipherSha256=fileSha(ciphertext);
    const report=await verifySnapshot({ciphertext,outputRoot:directory,privatePem,cipherSha256,manifestSha256:prepared.manifestSha256,python,counts});
    if (fileSha(path.join(directory,'originals-manifest.json'))!==report.manifestSha256) throw Error('Local manifest changed');
    fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    // Only encrypted snapshot, local immutable manifest and receipt remain.
    removeOwned(path.join(directory,'snapshot'),directory,'snapshot',python);
    fs.unlinkSync(archive);
    complete=true;
    return {directory,ciphertext,report};
  } finally { if (!complete) removeOwned(directory,outputRoot,'originals-snapshot-',python); }
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [mode,...args]=process.argv.slice(2);
    let report;
    if (mode==='create' && [4,5].includes(args.length)) {
      const [repo,outputRoot,publicPem,privatePem,python]=args;
      ({report}=await createSnapshot({repo,outputRoot,publicPem,privatePem,python}));
    } else if (mode==='verify' && [5,6].includes(args.length)) {
      const [ciphertext,outputRoot,privatePem,cipherSha256,manifestSha256,python]=args;
      report=await verifySnapshot({ciphertext,outputRoot,privatePem,cipherSha256,manifestSha256,python});
    } else throw Error('Rejected invocation');
    console.log(JSON.stringify(report));
  } catch { console.error('Original media backup failed; no verified snapshot published.');process.exitCode=1; }
}
