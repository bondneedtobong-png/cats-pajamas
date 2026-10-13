$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\backup-collect.ps1" -LibraryOnly
$temp = Join-Path ([IO.Path]::GetTempPath()) ('cats-backup-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
function Assert($Condition, $Message) { if (!$Condition) { throw $Message } }
try {
    $now = [datetime]::UtcNow
    Assert (Test-BackupNotificationDue $null $now) 'First notification suppressed'
    Assert (!(Test-BackupNotificationDue ($now.AddHours(-23).ToString('o')) $now)) 'Duplicate notification allowed'
    Assert (Test-BackupNotificationDue ($now.AddHours(-24).ToString('o')) $now) 'Daily notification suppressed'
    Assert (Test-BackupNotificationDue 'invalid' $now) 'Invalid notification date blocked retry'
    Set-BackupDirectoryAccess $temp
    $acl = (New-Object IO.DirectoryInfo($temp)).GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
    Assert (Test-BackupDirectoryAccess $acl) 'Backup directory ACL hardening failed'
    $before = $acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
    Set-BackupDirectoryAccess $temp
    $after = (New-Object IO.DirectoryInfo($temp)).GetAccessControl([Security.AccessControl.AccessControlSections]::Access).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
    Assert ($before -eq $after) 'Already restricted ACL changed'
    Assert (!(Test-BackupName '../20261013-033000.tar.gz')) 'Traversal accepted'
    Assert (!(Test-BackupName '20261013-033000.tar.gz.partial')) 'Partial accepted'
    Assert ((Get-BackupTimestamp '20261013-033000.tar.gz').Kind -eq 'Utc') 'Date is not UTC'
    $fixture = Join-Path $temp 'fixture'
    [IO.File]::WriteAllText($fixture, 'complete archive fixture')
    $expected = (Get-FileHash $fixture).Hash
    Assert-BackupHash $fixture $expected
    [IO.File]::WriteAllText($fixture, 'truncated')
    $rejected = $false
    try { Assert-BackupHash $fixture $expected } catch { $rejected = $true }
    Assert $rejected 'Truncated backup accepted'
    $Destination = $temp
    $RetentionDays = 30
    $MaxAgeHours = 36
    $script:name = [datetime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.tar.gz'
    $script:body = 'mock complete archive'
    $script:fixtureHashPath = Join-Path $temp 'hashfixture'
    [IO.File]::WriteAllText($script:fixtureHashPath, $script:body)
    $script:hash = (Get-FileHash $script:fixtureHashPath).Hash
    function Invoke-BackupTool([string]$Tool, [string[]]$Arguments) {
        if ($Arguments[-1] -like 'find *') { return @('../unsafe.tar.gz', $script:name) }
        if ($Arguments[-1] -like 'sha256sum *') { return "$script:hash  remote" }
        [IO.File]::WriteAllText($Arguments[-1], $script:body)
    }
    Invoke-BackupCollection
    Assert (Test-Path (Join-Path $temp $script:name)) 'Verified archive missing'
    Assert ((Get-Content (Join-Path $temp 'status.json') -Raw | ConvertFrom-Json).ok) 'Success status missing'
    $statusPath = Join-Path $temp 'status.json'
    $status = Get-Content $statusPath -Raw | ConvertFrom-Json
    $status.lastNotificationUtc = $now.ToString('o')
    $status | ConvertTo-Json | Set-Content $statusPath
    [IO.File]::WriteAllText((Join-Path $temp $script:name), 'existing corrupt archive')
    Invoke-BackupCollection
    Assert-BackupHash (Join-Path $temp $script:name) $script:hash
    Assert ((Get-Content $statusPath -Raw | ConvertFrom-Json).lastNotificationUtc -eq $now.ToString('o')) 'Success reset notification deduplication'
    foreach ($unsafe in @('C:\', 'C:\Users', 'C:\Users\bond', 'relative', 'C:\Users\bond\..\backups', 'C:\bad"path')) {
        $rejected = $false
        try { & "$PSScriptRoot\backup-install.ps1" -Destination $unsafe } catch { $rejected = $true }
        Assert $rejected "Unsafe install destination accepted: $unsafe"
    }
    New-Item -ItemType File -Path (Join-Path $temp '20000101-000000.tar.gz') | Out-Null
    New-Item -ItemType File -Path (Join-Path $temp 'keep-secret.env') | Out-Null
    Remove-ExpiredBackups $temp ([datetime]::UtcNow.AddDays(-30)) $script:name
    Assert (!(Test-Path (Join-Path $temp '20000101-000000.tar.gz'))) 'Expired archive retained'
    Assert (Test-Path (Join-Path $temp 'keep-secret.env')) 'Unknown file deleted'
    $script:name = '20000101-000000.tar.gz'
    function Start-Sleep { param($Seconds) }
    $rejected = $false
    try { Invoke-BackupCollection } catch { $rejected = $true }
    Assert $rejected 'Stale archive accepted'
    $script:name = [datetime]::UtcNow.AddMinutes(-1).ToString('yyyyMMdd-HHmmss') + '.tar.gz'
    $script:body = 'truncated transfer'
    $rejected = $false
    try { Invoke-BackupCollection } catch { $rejected = $true }
    Assert $rejected 'Corrupt transfer accepted'
    Assert (!(Test-Path (Join-Path $temp $script:name))) 'Corrupt final archive exists'
    Assert (@(Get-ChildItem $temp -Filter '*.partial').Count -eq 0) 'Partial not removed'
    function Invoke-BackupTool { throw 'mock connection failure' }
    $rejected = $false
    try { Invoke-BackupCollection } catch { $rejected = $true }
    Assert $rejected 'Connection failure accepted'
    Write-Output 'PASS: UTC, traversal, truncation, success, corrupt existing archive recovery, unsafe install rejection, retention, stale archive, corrupt transfer cleanup, connection failure'
} finally {
    # Temp target is fixed and checked before recursive cleanup.
    $resolved = [IO.Path]::GetFullPath($temp)
    if (!$resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'cats-backup-test-*') { throw 'Unsafe test cleanup target' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
