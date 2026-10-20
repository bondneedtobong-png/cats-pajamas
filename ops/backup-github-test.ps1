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
  string phase=args[0]; if(args.Length>1) phase=args[1].EndsWith("/zip")?"download":args[1].Contains("/workflows/")?"runs":"artifacts";
  string counter=Path.Combine(root,mode+"-"+phase+".count"); int count=File.Exists(counter)?int.Parse(File.ReadAllText(counter))+1:1; File.WriteAllText(counter,count.ToString());
  if(args[0]=="hang") { File.WriteAllText(Path.Combine(root,"hang.pid"),System.Diagnostics.Process.GetCurrentProcess().Id.ToString());Thread.Sleep(60000);return 0; }
  if(args[0]=="timeout-once") { if(count==1) { File.WriteAllText(Path.Combine(root,"timeout-once.pid"),System.Diagnostics.Process.GetCurrentProcess().Id.ToString());Thread.Sleep(60000); } Console.Write("{}");return 0; }
  if(args[0]=="oversize") { Console.OpenStandardOutput().Write(new byte[4096],0,4096);return 0; }
  if(mode=="persistent" || (mode=="transient-json" && phase=="runs" && count==1)) { Console.Error.Write("private-stderr-sentinel"); return 7; }
  if(mode=="malformed-json" && phase=="runs") { Console.Write("private-payload-sentinel"); return 0; }
  if(phase=="download") {
   if(mode=="transient-download" && count==1) { Console.OpenStandardOutput().Write(new byte[32],0,32);Console.Error.Write("private-download-sentinel");return 8; }
   string zipMode=mode.StartsWith("transient-")?"fresh":mode;
   var bytes=File.ReadAllBytes(Path.Combine(root,zipMode+".zip"));Console.OpenStandardOutput().Write(bytes,0,bytes.Length);return 0;
  }
  if(args[1].Contains("/workflows/")) Console.Write(mode=="none"?"{\"workflow_runs\":[]}":"{\"workflow_runs\":[{\"id\":123,\"status\":\"completed\",\"conclusion\":\"success\",\"head_branch\":\"main\",\"event\":\"schedule\",\"path\":\".github/workflows/backup.yml\",\"repository\":{\"full_name\":\"bondneedtobong-png/cats-pajamas\"},\"head_sha\":\"abc\",\"created_at\":\"2026-10-14T00:00:00Z\"}]}");
  else Console.Write("{\"artifacts\":[{\"id\":456,\"name\":\"protected-backup\",\"expired\":"+(mode=="invalidmetadata"?"true":"false")+",\"size_in_bytes\":2000,\"workflow_run\":{\"id\":123,\"head_branch\":\"main\",\"head_sha\":\"abc\"}}]}");
  return 0;
 }
}
'@
    $stub = Join-Path $root 'gh-stub.exe'
    Add-Type -TypeDefinition $stubSource -OutputAssembly $stub -OutputType ConsoleApplication
    . "$PSScriptRoot\backup-github-collect.ps1" -Destination $destination -GhPath $stub -NodePath $node -LibraryOnly -NoNotification
    # Capture the real retry policy without slowing these child-process fixtures.
    $script:retrySleeps = @()
    function Start-Sleep { param([int]$Seconds) $script:retrySleeps += $Seconds }
    Set-Content -LiteralPath (Join-Path $root 'mode') -Value 'fresh' -NoNewline
    Invoke-GithubBackupCollection
    $statusPath = Join-Path $destination 'status.json'
    $success = Get-Content $statusPath -Raw | ConvertFrom-Json
    Assert ($success.ok -and $success.runId -eq '123' -and $success.source -eq 'GitHub Actions') 'Verified success missing'
    $archive = Join-Path $destination $success.archive
    Assert-BackupHash $archive $success.sha256
    foreach ($mode in @('transient-json','transient-download')) {
        $script:retrySleeps = @()
        Set-Content -LiteralPath (Join-Path $root 'mode') -Value $mode -NoNewline
        Invoke-GithubBackupCollection
        $phase = if ($mode -eq 'transient-json') { 'runs' } else { 'download' }
        Assert ([IO.File]::ReadAllText((Join-Path $root ($mode+'-'+$phase+'.count'))) -eq '2') "Transient child was not retried: $mode"
        Assert ($script:retrySleeps.Count -eq 1 -and $script:retrySleeps[0] -eq 10) "Retry backoff mismatch: $mode"
        Assert ((Get-Content $statusPath -Raw | ConvertFrom-Json).ok) "Retry recovery failed: $mode"
        Assert-BackupHash $archive $success.sha256
    }
    $saved = Get-Content $statusPath -Raw | ConvertFrom-Json
    $saved.lastNotificationUtc = '2026-10-14T01:02:03Z'
    $saved | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statusPath -Encoding UTF8
    [IO.File]::WriteAllText((Join-Path $destination 'unknown.env'),'keep')
    foreach ($mode in @('tamper','stale','none','traversal','unknown','symlink','zipoversize','persistent','malformed-json','invalidmetadata')) {
        $script:retrySleeps = @()
        Set-Content -LiteralPath (Join-Path $root 'mode') -Value $mode -NoNewline
        $failed = $false
        try { Invoke-GithubBackupCollection } catch { $failed = $true }
        Assert $failed "Failure accepted: $mode"
        $status = Get-Content $statusPath -Raw | ConvertFrom-Json
        Assert (!$status.ok -and $status.lastSuccess.sha256 -eq $success.sha256) "History lost: $mode"
        Assert ($status.lastNotificationUtc -ceq $saved.lastNotificationUtc) "Notification state changed: $mode"
        Assert ($status.diagnostic.stage -and $status.diagnostic.code -and (Get-Content $statusPath -Raw) -notmatch 'sentinel|repos/|https?://') "Unsafe or absent diagnostic: $mode"
        if ($mode -eq 'persistent') {
            Assert ([IO.File]::ReadAllText((Join-Path $root 'persistent-runs.count')) -eq '3') 'Persistent process retry bound failed'
            Assert (($script:retrySleeps -join ',') -ceq '10,20') 'Persistent retry backoff mismatch'
            Assert ($status.diagnostic.stage -ceq 'list_runs' -and $status.diagnostic.code -ceq 'process_exit' -and $status.diagnostic.exitCode -eq 7) 'Safe process exit diagnostic missing'
        } else {
            Assert ($script:retrySleeps.Count -eq 0) "Terminal validation retried: $mode"
        }
        if ($mode -eq 'malformed-json') { Assert ($status.diagnostic.code -ceq 'invalid_json' -and [IO.File]::ReadAllText((Join-Path $root 'malformed-json-runs.count')) -eq '1') 'Malformed JSON was retried or misdiagnosed' }
        if ($mode -eq 'invalidmetadata') { Assert ($status.diagnostic.stage -ceq 'validate_artifact' -and $status.diagnostic.code -ceq 'metadata_rejected') 'Artifact validation diagnostic missing' }
        Assert-BackupHash $archive $success.sha256
    }
    Assert (Test-Path (Join-Path $destination 'unknown.env')) 'Unknown root file removed'
    Assert (@(Get-ChildItem $destination -Directory).Count -eq 0) 'Rejected ZIP content escaped or owned cleanup failed'
    $failed = $false
    try { [CatsGithubProcess]::Run($stub,@('oversize'),$null,1024,5) | Out-Null } catch { $failed = $true }
    Assert $failed 'Actual stdout size cap not enforced'
    $script:retrySleeps = @()
    $failed = $false
    try { Invoke-GithubProcess $stub @('oversize') $null 1024 5 | Out-Null } catch { $failed = $true }
    Assert ($failed -and $script:retrySleeps.Count -eq 0) 'Output limit was retried'
    $failed = $false
    try { Invoke-GithubProcess (Join-Path $root 'missing-tool.exe') @() $null 1024 5 | Out-Null } catch { $failed = $true }
    Assert ($failed -and $script:retrySleeps.Count -eq 0) 'Local process/IO failure was retried'
    $existing = Join-Path $root 'preexisting.zip'
    [IO.File]::WriteAllText($existing,'preserve existing')
    $failed = $false
    try { Invoke-GithubProcess $stub @('oversize') $existing 1024 5 | Out-Null } catch { $failed = $true }
    Assert ($failed -and [IO.File]::ReadAllText($existing) -ceq 'preserve existing') 'Preexisting output was deleted or overwritten'
    $failed = $false; $timer = [Diagnostics.Stopwatch]::StartNew()
    try { [CatsGithubProcess]::Run($stub,@('hang'),$null,1024,1) | Out-Null } catch { $failed = $true }
    Assert ($failed -and $timer.Elapsed.TotalSeconds -lt 10) 'Silent process timeout failed'
    $hangPid = [int][IO.File]::ReadAllText((Join-Path $root 'hang.pid'))
    Assert (!(Get-Process -Id $hangPid -ErrorAction SilentlyContinue)) 'Timed-out child remained alive'
    Invoke-GithubProcess $stub @('timeout-once') $null 1024 1 0 | Out-Null
    Assert ([IO.File]::ReadAllText((Join-Path $root ($mode+'-timeout-once.count'))) -eq '2') 'Transient timeout was not retried'
    $timeoutPid = [int][IO.File]::ReadAllText((Join-Path $root 'timeout-once.pid'))
    Assert (!(Get-Process -Id $timeoutPid -ErrorAction SilentlyContinue)) 'Retried timed-out child remained alive'
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
    # Construct real Task Scheduler CIM objects; intercept only registration so
    # policy regressions are tested without changing any installed Windows task.
    # Load the CIM proxy functions first: module autoload would otherwise replace
    # a same-name fixture function during New-ScheduledTaskAction construction.
    Import-Module ScheduledTasks -ErrorAction Stop
    Import-Module CimCmdlets -ErrorAction Stop
    function global:Register-ScheduledTask {
        param($TaskName,$Action,$Trigger,$Settings,$Principal,$Description,[switch]$Force)
        $script:installedTask = @{ name=$TaskName; action=$Action; trigger=$Trigger; settings=$Settings; principal=$Principal }
    }
    Assert ((Get-Command Register-ScheduledTask).Definition -match 'script:installedTask') 'Fixture registration interception is not active'
    # No new module may replace that interception during the installer call.
    $PSModuleAutoLoadingPreference = 'None'
    . "$PSScriptRoot\backup-github-install.ps1" -Destination $destination | Out-Null
    $task = $script:installedTask
    Assert ($task.name -ceq 'CatsPajamas-OffServerBackup') 'Installer task name changed'
    Assert ([datetime]::Parse($task.trigger.StartBoundary).ToString('HH:mm') -ceq '08:45' -and $task.trigger.DaysInterval -eq 1) 'Daily trigger changed'
    Assert ($task.trigger.Repetition.Interval -ceq 'PT2H' -and $task.trigger.Repetition.Duration -ceq 'P1D' -and !$task.trigger.Repetition.StopAtDurationEnd) 'Two-hour daily repetition missing'
    Assert ($task.settings.RestartCount -eq 3 -and $task.settings.RestartInterval -ceq 'PT30M' -and $task.settings.StartWhenAvailable) 'Scheduler failure or missed-start recovery missing'
    Assert (!$task.settings.DisallowStartIfOnBatteries -and !$task.settings.StopIfGoingOnBatteries -and !$task.settings.WakeToRun) 'Battery/no-wake policy changed'
    Assert ($task.settings.MultipleInstances -eq 2 -and $task.settings.ExecutionTimeLimit -ceq 'PT20M') 'Scheduler concurrency/time bounds changed'
    Assert ($task.principal.UserId -ceq [Security.Principal.WindowsIdentity]::GetCurrent().Name -and $task.principal.LogonType -eq 3 -and $task.principal.RunLevel -eq 0) 'Current-user limited interactive principal changed'
    Assert ($task.action.Execute -ceq "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -and $task.action.Arguments -match '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ') 'Hidden Windows PowerShell action changed'
    Write-Output 'GitHub collector fixtures passed (transient JSON/download recovery, bounded retries/backoff, safe diagnostics, terminal metadata/JSON/tamper/freshness/ZIP rejection, output ownership/limits, child timeout, last success/notification preservation, shared lock, differing archive, real-CIM installer schedule/principal/action policy).'
} finally {
    Remove-Item Env:CATS_BACKUP_FIXTURE -ErrorAction SilentlyContinue
    $full = [IO.Path]::GetFullPath($root)
    if ((Split-Path $full -Parent) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and (Split-Path $full -Leaf) -match '^cats-github-test-[a-f0-9]{32}$') { Remove-Item -LiteralPath $full -Recurse -Force }
}
