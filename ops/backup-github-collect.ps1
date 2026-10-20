param(
    [string]$Destination = 'C:\Users\bond\mcp\cats-pajamas-backups',
    [string]$GhPath = 'C:\Users\bond\gh-cli\bin\gh.exe',
    [string]$NodePath = 'C:\Program Files\nodejs\node.exe',
    [int]$RetentionDays = 30,
    [int]$MaxAgeHours = 36,
    [switch]$LibraryOnly,
    [switch]$NoNotification
)
$ErrorActionPreference = 'Stop'
# Node/npm can inherit PowerShell 7's module search path when starting Windows
# PowerShell 5.1. Load this host's built-in utility module explicitly so the
# independent SHA256 check cannot resolve an incompatible shadowed module.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
# Restore our parameters after loading the legacy collector's shared helpers.
$settings = @{ Destination=$Destination; GhPath=$GhPath; NodePath=$NodePath; RetentionDays=$RetentionDays; MaxAgeHours=$MaxAgeHours; LibraryOnly=$LibraryOnly; NoNotification=$NoNotification }
. "$PSScriptRoot\backup-collect.ps1" -LibraryOnly
foreach ($entry in $settings.GetEnumerator()) { Set-Variable -Name $entry.Key -Value $entry.Value }

# Read raw stdout without PowerShell's text conversion. Both byte count and wall
# time are enforced while the child is running, including a silent stalled child.
if (!('CatsGithubProcess' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Diagnostics;
using System.Text;
public sealed class CatsGithubProcessException : Exception {
    public string Code { get; private set; }
    public int? ExitCode { get; private set; }
    public CatsGithubProcessException(string code, int? exitCode=null) : base(code) { Code=code; ExitCode=exitCode; }
}
public static class CatsGithubProcess {
    static string Quote(string value) {
        var b = new StringBuilder("\""); int slashes=0;
        foreach(char c in value) {
            if(c=='\\') { slashes++; continue; }
            if(c=='"') { b.Append('\\',slashes*2+1); b.Append(c); }
            else { b.Append('\\',slashes); b.Append(c); }
            slashes=0;
        }
        b.Append('\\',slashes*2); b.Append('"'); return b.ToString();
    }
    public static byte[] Run(string file, string[] args, string output, long maximum, int seconds) {
        if(maximum<1 || seconds<1) throw new Exception("Invalid process bounds");
        var start = new ProcessStartInfo(file);
        var quoted=new string[args.Length]; for(int i=0;i<args.Length;i++) quoted[i]=Quote(args[i]);
        start.Arguments=string.Join(" ",quoted); start.UseShellExecute=false;
        start.CreateNoWindow=true; start.RedirectStandardOutput=true; start.RedirectStandardError=true;
        start.EnvironmentVariables["GH_PROMPT_DISABLED"]="1";
        using(var process=new Process()) {
            process.StartInfo=start;
            Stream target=null; bool createdOutput=false, completed=false; var clock=Stopwatch.StartNew();
            try {
                target=string.IsNullOrEmpty(output) ? (Stream)new MemoryStream() : new FileStream(output,FileMode.CreateNew,FileAccess.Write,FileShare.None);
                createdOutput=!string.IsNullOrEmpty(output);
                if(!process.Start()) throw new CatsGithubProcessException("process_start");
                // Binary draining keeps even an unterminated diagnostic line bounded.
                var diagnostics=process.StandardError.BaseStream.CopyToAsync(Stream.Null);
                var buffer=new byte[65536]; long total=0;
                while(true) {
                    int remaining=(int)Math.Max(0,seconds*1000L-clock.ElapsedMilliseconds);
                    var read=process.StandardOutput.BaseStream.ReadAsync(buffer,0,buffer.Length);
                    if(remaining==0 || !read.Wait(remaining)) throw new CatsGithubProcessException("process_timeout");
                    int count=read.Result; if(count==0) break;
                    total+=count; if(total>maximum) throw new CatsGithubProcessException("output_limit");
                    target.Write(buffer,0,count);
                }
                int wait=(int)Math.Max(0,seconds*1000L-clock.ElapsedMilliseconds);
                if(!process.WaitForExit(wait)) throw new CatsGithubProcessException("process_timeout");
                if(process.ExitCode!=0) throw new CatsGithubProcessException("process_exit",process.ExitCode);
                target.Flush(); completed=true; return string.IsNullOrEmpty(output) ? ((MemoryStream)target).ToArray() : null;
            } catch(CatsGithubProcessException) { throw;
            } catch { throw new CatsGithubProcessException("process_io");
            } finally {
                try { if(!process.HasExited) { process.Kill(); process.WaitForExit(5000); } } catch { }
                if(target!=null) target.Dispose();
                // Only the stream successfully created by this attempt is ours.
                if(createdOutput && !completed) File.Delete(output);
            }
        }
    }
}
'@
}
function Get-GithubProcessFailure($Exception) {
    while ($Exception) {
        if ($Exception -is [CatsGithubProcessException] -and $Exception.Code -cin @('process_start','process_timeout','process_exit','process_io','output_limit')) { return $Exception }
        $Exception = $Exception.InnerException
    }
    return $null
}
function Invoke-GithubProcess([string]$Tool, [string[]]$Arguments, [string]$OutputPath, [long]$Maximum, [int]$Seconds, [int]$RetryDelaySeconds = 10) {
    # A transient CLI/network error previously ended the day's only attempt.
    # Retry only the bounded transfer, never failed ZIP/authentication validation.
    if ($OutputPath -and (Test-Path -LiteralPath $OutputPath)) { throw 'Transfer output already exists' }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try { return [CatsGithubProcess]::Run($Tool,$Arguments,$OutputPath,$Maximum,$Seconds) }
        catch {
            $failure = Get-GithubProcessFailure $_.Exception
            if (!$failure -or $failure.Code -cnotin @('process_timeout','process_exit') -or $attempt -eq 3) { throw }
            if ($RetryDelaySeconds -gt 0) { Start-Sleep -Seconds ($RetryDelaySeconds * $attempt) }
        }
    }
}
function Invoke-GithubJson([string]$Tool, [string[]]$Arguments, [switch]$Retry) {
    # Worst-case GH transfers/backoff + ZIP/decrypt stay below the task's 20m cap.
    $bytes = if ($Retry) { Invoke-GithubProcess $Tool $Arguments $null 1MB 45 } else { [CatsGithubProcess]::Run($Tool,$Arguments,$null,1MB,120) }
    return [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
}
function Expand-GithubBackupZip([string]$ZipPath, [string]$Folder) {
    Add-Type -AssemblyName System.IO.Compression
    $file = [IO.File]::OpenRead($ZipPath); $zip = $null; $input = $null; $output = $null
    $partial = Join-Path $Folder 'latest.enc.partial'
    try {
        $zip = New-Object IO.Compression.ZipArchive($file,[IO.Compression.ZipArchiveMode]::Read,$false)
        if ($zip.Entries.Count -ne 1) { throw 'Unexpected ZIP entries' }
        $entry = $zip.Entries[0]
        # Exact name forbids all directory/path variants; Unix mode rejects symlinks.
        if ($entry.FullName -cne 'latest.enc' -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960 -or $entry.Length -lt 28 -or $entry.Length -gt (512MB+16384)) { throw 'Invalid ZIP entry' }
        $input = $entry.Open()
        $output = [IO.File]::Open($partial,'CreateNew','Write','None')
        $buffer = New-Object byte[] 65536; $total = [int64]0; $timer = [Diagnostics.Stopwatch]::StartNew()
        while (($count = $input.Read($buffer,0,$buffer.Length)) -gt 0) {
            $total += $count
            if ($total -gt (512MB+16384) -or $total -gt $entry.Length -or $timer.Elapsed.TotalSeconds -gt 120) { throw 'Expanded ZIP exceeds bounds' }
            $output.Write($buffer,0,$count)
        }
        if ($total -ne $entry.Length) { throw 'ZIP length mismatch' }
        $output.Dispose(); $output = $null
        [IO.File]::Move($partial,(Join-Path $Folder 'latest.enc'))
    } finally {
        if ($output) { $output.Dispose() }; if ($input) { $input.Dispose() }; if ($zip) { $zip.Dispose() }; $file.Dispose()
        if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
    }
}

function Read-GithubBackupHeader([string]$Path) {
    $file = Get-Item -LiteralPath $Path -Force
    if (!$file.PSIsContainer -and !($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $file.Length -le (512MB + 16384)) { } else { throw 'Invalid envelope file' }
    $stream = [IO.File]::OpenRead($Path)
    try {
        $prefix = New-Object byte[] 12
        if ($stream.Read($prefix,0,12) -ne 12 -or [Text.Encoding]::ASCII.GetString($prefix,0,8) -cne "CPBK001`n") { throw 'Invalid envelope' }
        $length = [int64]$prefix[8]*16777216 + [int64]$prefix[9]*65536 + [int64]$prefix[10]*256 + $prefix[11]
        if ($length -lt 1 -or $length -gt 8192 -or $file.Length -lt (28+$length)) { throw 'Invalid header length' }
        $bytes = New-Object byte[] ([int]$length)
        if ($stream.Read($bytes,0,$bytes.Length) -ne $bytes.Length) { throw 'Truncated header' }
        $meta = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
        if (!(Test-BackupName $meta.archive) -or $meta.version -ne 1 -or $meta.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $meta.size -isnot [ValueType] -or $meta.size -lt 0 -or $meta.size -gt 512MB -or $meta.size -ne [math]::Floor($meta.size) -or $file.Length -ne (28+$length+$meta.size)) { throw 'Invalid envelope metadata' }
        $stamp = Get-BackupTimestamp $meta.archive
        if ($stamp -lt [datetime]::UtcNow.AddHours(-$MaxAgeHours) -or $stamp -gt [datetime]::UtcNow.AddMinutes(10)) { throw 'Stale backup' }
        return $meta
    } finally { $stream.Dispose() }
}

function Invoke-GithubBackupCollection {
    if ($RetentionDays -lt 2 -or $MaxAgeHours -lt 1) { throw 'Invalid backup policy' }
    Assert-BackupDirectory $Destination
    $Destination = [IO.Path]::GetFullPath($Destination).Replace('/','\')
    Assert-BackupDirectory $Destination
    if (!(Test-Path -LiteralPath $Destination -PathType Container)) { throw 'Protected backup directory missing' }
    $lock = $null; $owned = $null; $stage = 'lock'
    try {
        # Shared with the SCP collector; status and archives have a single writer.
        $lock = [IO.File]::Open((Join-Path $Destination 'collector.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
        $stage = 'directory_access'
        Set-BackupDirectoryAccess $Destination
        $repo = 'bondneedtobong-png/cats-pajamas'
        $stage = 'list_runs'
        $runs = (Invoke-GithubJson $GhPath @('api',"repos/$repo/actions/workflows/backup.yml/runs?branch=main&status=success&per_page=100") -Retry).workflow_runs
        $stage = 'validate_run'
        $run = @($runs | Where-Object { $_.status -ceq 'completed' -and $_.conclusion -ceq 'success' -and $_.head_branch -ceq 'main' -and $_.event -cin @('schedule','workflow_dispatch') -and $_.path -ceq '.github/workflows/backup.yml' -and $_.repository.full_name -ceq $repo } | Sort-Object { [datetime]$_.created_at } -Descending | Select-Object -First 1)
        if ($run.Count -ne 1 -or [string]$run[0].id -notmatch '^\d+$') { throw 'No trusted successful backup run' }
        $runId = [string]$run[0].id
        $stage = 'list_artifacts'
        $artifacts = (Invoke-GithubJson $GhPath @('api',"repos/$repo/actions/runs/$runId/artifacts?per_page=100") -Retry).artifacts
        $stage = 'validate_artifact'
        $artifact = @($artifacts | Where-Object { $_.name -ceq 'protected-backup' })
        if ($artifact.Count -ne 1 -or $artifact[0].expired -ne $false -or [string]$artifact[0].id -notmatch '^\d+$' -or $artifact[0].size_in_bytes -le 0 -or $artifact[0].size_in_bytes -gt (512MB+16384) -or [string]$artifact[0].workflow_run.id -cne $runId -or $artifact[0].workflow_run.head_branch -cne 'main' -or $artifact[0].workflow_run.head_sha -cne $run[0].head_sha) { throw 'Invalid backup artifact' }
        $stage = 'prepare_download'
        $owned = Join-Path $Destination ('github-download-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $owned | Out-Null
        $zipPath = Join-Path $owned 'artifact.zip'
        $stage = 'download'
        Invoke-GithubProcess $GhPath @('api',"repos/$repo/actions/artifacts/$($artifact[0].id)/zip") $zipPath (512MB+16384) 150 | Out-Null
        $stage = 'expand_zip'
        Assert-BackupDirectory $owned
        Expand-GithubBackupZip $zipPath $owned
        Remove-Item -LiteralPath $zipPath
        $files = @(Get-ChildItem -LiteralPath $owned -Force)
        if ($files.Count -ne 1 -or $files[0].Name -cne 'latest.enc') { throw 'Unexpected artifact contents' }
        $stage = 'validate_envelope'
        $meta = Read-GithubBackupHeader $files[0].FullName
        $keyPath = Join-Path $Destination 'cats-backup-decryption-key.pem'
        $stage = 'decrypt'
        $result = Invoke-GithubJson $NodePath @((Join-Path $PSScriptRoot 'backup-envelope.mjs'),'decrypt',$files[0].FullName,$Destination,$keyPath)
        if (!$result.ok -or $result.archive -cne $meta.archive -or $result.sha256 -cne $meta.sha256) { throw 'Decryption verification failed' }
        $stage = 'verify_hash'
        Assert-BackupHash (Join-Path $Destination $result.archive) $result.sha256
        $stage = 'retention'
        Remove-ExpiredBackups $Destination ([datetime]::UtcNow.AddDays(-$RetentionDays)) $result.archive
        $stage = 'write_status'
        $notification = $null
        try { $notification = (Get-Content -LiteralPath (Join-Path $Destination 'status.json') -Raw | ConvertFrom-Json).lastNotificationUtc } catch { }
        $success = @{ checkedUtc=[datetime]::UtcNow.ToString('o'); archive=$result.archive; sha256=$result.sha256; source='GitHub Actions'; runId=$runId; artifactId=[string]$artifact[0].id }
        @{ ok=$true; checkedUtc=$success.checkedUtc; archive=$success.archive; sha256=$success.sha256; source=$success.source; runId=$runId; artifactId=$success.artifactId; lastSuccess=$success; lastNotificationUtc=$notification } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Destination 'status.json') -Encoding UTF8
    } catch {
        # Public diagnostics are fixed stage/code values and an optional integer.
        # Never retain stderr, exception text, command arguments, URLs or payloads.
        $failure = Get-GithubProcessFailure $_.Exception
        $diagnostic = @{ stage=$stage; code='stage_failed' }
        if ($failure) {
            $diagnostic.code = $failure.Code
            if ($null -ne $failure.ExitCode) { $diagnostic.exitCode = [int]$failure.ExitCode }
        } elseif ($stage -in @('list_runs','list_artifacts')) { $diagnostic.code = 'invalid_json' }
        elseif ($stage -in @('validate_run','validate_artifact')) { $diagnostic.code = 'metadata_rejected' }
        elseif ($stage -eq 'expand_zip') { $diagnostic.code = 'zip_rejected' }
        elseif ($stage -eq 'validate_envelope') { $diagnostic.code = 'envelope_rejected' }
        elseif ($stage -eq 'decrypt') { $diagnostic.code = 'decryption_rejected' }
        elseif ($stage -eq 'verify_hash') { $diagnostic.code = 'checksum_rejected' }
        # A failed lock acquisition must never write the other collector's status.
        if ($lock) {
            $previous = $null
            try { $previous = Get-Content -LiteralPath (Join-Path $Destination 'status.json') -Raw | ConvertFrom-Json } catch { }
            $last = $previous.lastSuccess
            if (!$last -and $previous.ok) { $last = $previous }
            $notification = $previous.lastNotificationUtc
            $notify = !$NoNotification -and (Test-BackupNotificationDue $notification)
            if ($notify) { $notification = [datetime]::UtcNow.ToString('o') }
            $message = 'Новая копия пока не сохранена. Прежние копии сохранены. Следующая попытка автоматически.'
            @{ ok=$false; checkedUtc=[datetime]::UtcNow.ToString('o'); error=$message; diagnostic=$diagnostic; lastSuccess=$last; lastNotificationUtc=$notification } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Destination 'status.json') -Encoding UTF8
            if ($notify) { try { Show-BackupFailureToast $message } catch { } }
        }
        throw 'GitHub backup collection failed; previous verified copies preserved.'
    } finally {
        try { if ($owned) {
            # Delete only our verified GUID child. Unknown content is never traversed.
            $expected = Join-Path $Destination (Split-Path $owned -Leaf)
            if ($owned -ceq $expected -and (Split-Path $owned -Leaf) -match '^github-download-[a-f0-9]{32}$' -and !((Get-Item -LiteralPath $owned -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                foreach ($known in @('latest.enc','latest.enc.partial','artifact.zip')) {
                    $enc = Join-Path $owned $known
                    if (Test-Path -LiteralPath $enc -PathType Leaf) { Remove-Item -LiteralPath $enc -Force }
                }
                if (@(Get-ChildItem -LiteralPath $owned -Force).Count -eq 0) { Remove-Item -LiteralPath $owned -Force }
            }
        } } finally { if ($lock) { $lock.Dispose() } }
    }
}
if (!$LibraryOnly) {
    try { Invoke-GithubBackupCollection; exit 0 } catch { Write-Error 'Новая копия пока не сохранена. Прежние копии сохранены. Следующая попытка автоматически.' -ErrorAction Continue; exit 1 }
}
