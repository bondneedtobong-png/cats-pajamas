$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('cats-github-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
function Assert($Value, $Message) { if (!$Value) { throw $Message } }
try {
    $destination = Join-Path $root 'protected'
    New-Item -ItemType Directory -Path $destination | Out-Null
    $env:CATS_BACKUP_FIXTURE = $root
    $envelope = (Join-Path $PSScriptRoot 'backup-envelope.mjs').Replace('\','/')
    $js = @'
import {generateKeyPairSync,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.env.CATS_BACKUP_FIXTURE;
const args=process.argv.slice(2);
if(args[0]==='setup') {
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:4096,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 writeFileSync(join(root,'public.pem'),publicKey);writeFileSync(join(root,'protected','cats-backup-decryption-key.pem'),privateKey);
 writeFileSync(join(root,'plain'),'fixture archive');
 const {encrypt}=await import('file:///ENVELOPE');
 const hash=createHash('sha256').update('fixture archive').digest('hex');
 const stamp=d=>d.toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15)+'.tar.gz';
 encrypt(join(root,'plain'),join(root,'fresh.enc'),join(root,'public.pem'),hash,stamp(new Date()));
 encrypt(join(root,'plain'),join(root,'stale.enc'),join(root,'public.pem'),hash,stamp(new Date(Date.now()-48*3600000)));
 const tampered=readFileSync(join(root,'fresh.enc'));tampered[tampered.length-1]^=1;writeFileSync(join(root,'tamper.enc'),tampered);
}
'@
    $js.Replace('ENVELOPE',$envelope) | Set-Content -LiteralPath (Join-Path $root 'gh-fixture.mjs') -Encoding UTF8
    $node = (Get-Command node.exe).Source
    & $node (Join-Path $root 'gh-fixture.mjs') setup
    Assert ($LASTEXITCODE -eq 0) 'Fixture setup failed'
    Add-Type -AssemblyName System.IO.Compression
    foreach ($mode in @('fresh','tamper','stale','traversal','unknown','symlink')) {
        $zipFile = [IO.File]::Open((Join-Path $root ($mode+'.zip')),'CreateNew','Write','None')
        $zip = New-Object IO.Compression.ZipArchive($zipFile,[IO.Compression.ZipArchiveMode]::Create,$false)
        try {
            $entryName = 'latest.enc'; if ($mode -eq 'traversal') { $entryName = '../latest.enc' }
            $entry = $zip.CreateEntry($entryName)
            if ($mode -eq 'symlink') { $entry.ExternalAttributes = -1577123840 }
            $entryStream = $entry.Open()
            $kind = 'fresh'; if ($mode -in @('stale','tamper')) { $kind = $mode }
            $bytes = [IO.File]::ReadAllBytes((Join-Path $root ($kind+'.enc')))
            $entryStream.Write($bytes,0,$bytes.Length); $entryStream.Dispose()
            if ($mode -eq 'unknown') { $zip.CreateEntry('unknown.env') | Out-Null }
        } finally { $zip.Dispose(); $zipFile.Dispose() }
    }
    # Forge an excessive ZIP central-directory length without allocating a huge fixture.
    $oversizeZip = [IO.File]::ReadAllBytes((Join-Path $root 'fresh.zip'))
    $central = -1
    for ($i=0; $i -lt ($oversizeZip.Length-46); $i++) {
        if ($oversizeZip[$i] -eq 80 -and $oversizeZip[$i+1] -eq 75 -and $oversizeZip[$i+2] -eq 1 -and $oversizeZip[$i+3] -eq 2) { $central=$i; break }
    }
    Assert ($central -ge 0) 'Fixture ZIP central directory missing'
    [BitConverter]::GetBytes([uint32](512MB+16385)).CopyTo($oversizeZip,$central+24)
    [IO.File]::WriteAllBytes((Join-Path $root 'zipoversize.zip'),$oversizeZip)
    $stubSource = @'
using System; using System.IO; using System.Threading;
public static class GithubFixtureStub {
 public static int Main(string[] args) {
  string root=Environment.GetEnvironmentVariable("CATS_BACKUP_FIXTURE"), mode=File.ReadAllText(Path.Combine(root,"mode"));
  if(args[0]=="hang") { File.WriteAllText(Path.Combine(root,"hang.pid"),System.Diagnostics.Process.GetCurrentProcess().Id.ToString());Thread.Sleep(60000);return 0; }
  if(args[0]=="oversize") { Console.OpenStandardOutput().Write(new byte[4096],0,4096);return 0; }
  if(args[1].EndsWith("/zip")) { var bytes=File.ReadAllBytes(Path.Combine(root,mode+".zip"));Console.OpenStandardOutput().Write(bytes,0,bytes.Length);return 0; }
  if(args[1].Contains("/workflows/")) Console.Write(mode=="none"?"{\"workflow_runs\":[]}":"{\"workflow_runs\":[{\"id\":123,\"status\":\"completed\",\"conclusion\":\"success\",\"head_branch\":\"main\",\"event\":\"schedule\",\"path\":\".github/workflows/backup.yml\",\"repository\":{\"full_name\":\"bondneedtobong-png/cats-pajamas\"},\"head_sha\":\"abc\",\"created_at\":\"2026-10-14T00:00:00Z\"}]}");
  else Console.Write("{\"artifacts\":[{\"id\":456,\"name\":\"protected-backup\",\"expired\":false,\"size_in_bytes\":2000,\"workflow_run\":{\"id\":123,\"head_branch\":\"main\",\"head_sha\":\"abc\"}}]}");
  return 0;
 }
}
'@
    $stub = Join-Path $root 'gh-stub.exe'
    Add-Type -TypeDefinition $stubSource -OutputAssembly $stub -OutputType ConsoleApplication
    . "$PSScriptRoot\backup-github-collect.ps1" -Destination $destination -GhPath $stub -NodePath $node -LibraryOnly -NoNotification
    Set-Content -LiteralPath (Join-Path $root 'mode') -Value 'fresh' -NoNewline
    Invoke-GithubBackupCollection
    $statusPath = Join-Path $destination 'status.json'
    $success = Get-Content $statusPath -Raw | ConvertFrom-Json
    Assert ($success.ok -and $success.runId -eq '123' -and $success.source -eq 'GitHub Actions') 'Verified success missing'
    $archive = Join-Path $destination $success.archive
    Assert-BackupHash $archive $success.sha256
    [IO.File]::WriteAllText((Join-Path $destination 'unknown.env'),'keep')
    foreach ($mode in @('tamper','stale','none','traversal','unknown','symlink','zipoversize')) {
        Set-Content -LiteralPath (Join-Path $root 'mode') -Value $mode -NoNewline
        $failed = $false
        try { Invoke-GithubBackupCollection } catch { $failed = $true }
        Assert $failed "Failure accepted: $mode"
        $status = Get-Content $statusPath -Raw | ConvertFrom-Json
        Assert (!$status.ok -and $status.lastSuccess.sha256 -eq $success.sha256) "History lost: $mode"
        Assert-BackupHash $archive $success.sha256
    }
    Assert (Test-Path (Join-Path $destination 'unknown.env')) 'Unknown root file removed'
    Assert (@(Get-ChildItem $destination -Directory).Count -eq 0) 'Rejected ZIP content escaped or owned cleanup failed'
    $failed = $false
    try { [CatsGithubProcess]::Run($stub,@('oversize'),$null,1024,5) | Out-Null } catch { $failed = $true }
    Assert $failed 'Actual stdout size cap not enforced'
    $failed = $false; $timer = [Diagnostics.Stopwatch]::StartNew()
    try { [CatsGithubProcess]::Run($stub,@('hang'),$null,1024,1) | Out-Null } catch { $failed = $true }
    Assert ($failed -and $timer.Elapsed.TotalSeconds -lt 10) 'Silent process timeout failed'
    $hangPid = [int][IO.File]::ReadAllText((Join-Path $root 'hang.pid'))
    Assert (!(Get-Process -Id $hangPid -ErrorAction SilentlyContinue)) 'Timed-out child remained alive'
    $before = Get-Content $statusPath -Raw
    $held = [IO.File]::Open((Join-Path $destination 'collector.lock'),'OpenOrCreate','ReadWrite','None')
    try {
        $failed = $false
        try { Invoke-GithubBackupCollection } catch { $failed = $true }
        Assert $failed 'Concurrent collector accepted'
        Assert ((Get-Content $statusPath -Raw) -ceq $before) 'Lock loser changed status'
    } finally { $held.Dispose() }
    Set-Content -LiteralPath (Join-Path $root 'mode') -Value 'fresh' -NoNewline
    [IO.File]::WriteAllText($archive,'preserve differing archive')
    $failed = $false
    try { Invoke-GithubBackupCollection } catch { $failed = $true }
    Assert ($failed -and [IO.File]::ReadAllText($archive) -eq 'preserve differing archive') 'Differing archive overwritten'
    Write-Output 'GitHub collector fixtures passed (success, tamper, stale, absent run, ZIP traversal/unknown/symlink/oversize, bounded raw output, timeout child kill, shared lock, differing archive).'
} finally {
    Remove-Item Env:CATS_BACKUP_FIXTURE -ErrorAction SilentlyContinue
    $full = [IO.Path]::GetFullPath($root)
    if ((Split-Path $full -Parent) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and (Split-Path $full -Leaf) -match '^cats-github-test-[a-f0-9]{32}$') { Remove-Item -LiteralPath $full -Recurse -Force }
}
