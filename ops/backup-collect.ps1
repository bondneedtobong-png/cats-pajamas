param(
    [string]$Destination = 'C:\Users\bond\mcp\cats-pajamas-backups',
    [string]$SshPath = 'C:\Program Files\Git\usr\bin\ssh.exe',
    [string]$ScpPath = 'C:\Program Files\Git\usr\bin\scp.exe',
    [int]$RetentionDays = 30,
    [int]$MaxAgeHours = 36,
    [switch]$LibraryOnly
)
$ErrorActionPreference = 'Stop'

function Test-BackupName([string]$Name) {
    return $Name -cmatch '^\d{8}-\d{6}\.tar\.gz$'
}

function Assert-BackupDirectory([string]$Folder) {
    if (![IO.Path]::IsPathRooted($Folder) -or $Folder.Contains('"')) { throw 'Unsafe backup directory' }
    $full = [IO.Path]::GetFullPath($Folder).TrimEnd('\','/')
    if ($full -ne $Folder.TrimEnd('\','/') -or $full -eq [IO.Path]::GetPathRoot($full).TrimEnd('\','/')) { throw 'Unsafe backup directory' }
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Backup directory cannot use reparse points' }
        }
        $next = Split-Path $cursor -Parent
        if ($next -eq $cursor) { break }
        $cursor = $next
    }
}

function Test-BackupDirectoryAccess($Acl) {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $rules = @($Acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if (!$Acl.AreAccessRulesProtected -or $rules.Count -ne 2) { return $false }
    $seen = @{}
    foreach ($rule in $rules) {
        $value = $rule.IdentityReference.Value
        if ($value -notin @($sid, 'S-1-5-18') -or $seen.ContainsKey($value) -or $rule.IsInherited -or
            $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
            $rule.InheritanceFlags -ne ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit) -or
            $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) { return $false }
        $seen[$value] = $true
    }
    return $true
}

function Set-BackupDirectoryAccess([string]$Folder) {
    Assert-BackupDirectory $Folder
    $directory = New-Object IO.DirectoryInfo($Folder)
    # Read/write only DACL: do not request SACL/owner privileges from a normal user.
    $acl = $directory.GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
    if (Test-BackupDirectoryAccess $acl) { return }
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) { $acl.RemoveAccessRuleSpecific($rule) }
    foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    $directory.SetAccessControl($acl)
    $verified = $directory.GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
    if (!(Test-BackupDirectoryAccess $verified)) { throw 'Backup directory ACL verification failed' }
}

function Test-BackupNotificationDue([string]$LastNotificationUtc, [datetime]$Now = [datetime]::UtcNow) {
    $previous = [datetime]::MinValue
    if (![datetime]::TryParse($LastNotificationUtc, [cultureinfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$previous)) { return $true }
    return $previous.ToUniversalTime() -le $Now.AddHours(-24)
}

function Show-BackupFailureToast([string]$Message) {
    # Existing Windows PowerShell application identity; never register an app or use a modal fallback.
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $escaped = [Security.SecurityElement]::Escape($Message)
    $xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>Пижама Кота: резервная копия</text><text>' + $escaped + '</text></binding></visual></toast>')
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Microsoft.Windows.PowerShell').Show($toast)
}

function Get-BackupTimestamp([string]$Name) {
    if (!(Test-BackupName $Name)) { throw 'Invalid backup filename' }
    return [datetime]::ParseExact($Name.Substring(0,15), 'yyyyMMdd-HHmmss', [cultureinfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
}

function Assert-BackupHash([string]$Path, [string]$Expected) {
    if ($Expected -cnotmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid remote checksum' }
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Expected) { throw 'Backup checksum mismatch' }
}

function Invoke-BackupTool([string]$Tool, [string[]]$Arguments) {
    # Never expose command output: archives and SSH diagnostics may contain secrets.
    $output = & $Tool @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Backup transfer command failed' }
    return $output
}

function Remove-ExpiredBackups([string]$Folder, [datetime]$Cutoff, [string]$Keep) {
    # Only top-level timestamp archives; never recurse or delete unknown files.
    foreach ($file in Get-ChildItem -LiteralPath $Folder -File) {
        if ((Test-BackupName $file.Name) -and $file.Name -ne $Keep -and (Get-BackupTimestamp $file.Name) -lt $Cutoff) {
            Remove-Item -LiteralPath $file.FullName
        }
    }
}

function Invoke-BackupCollection {
    if ($RetentionDays -lt 2 -or $MaxAgeHours -lt 1) { throw 'Invalid backup policy' }
    Assert-BackupDirectory $Destination
    if (!(Test-Path -LiteralPath $Destination -PathType Container)) { throw 'Protected backup directory missing; run installer' }
    $lock = $null
    $partial = $null
    try {
        $lock = [IO.File]::Open((Join-Path $Destination 'collector.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
        $sshOptions = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=30','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2')
        $lastError = 'Backup collection failed'
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            try {
                $names = @(Invoke-BackupTool $SshPath ($sshOptions + @('cats-pajamas', 'find /var/backups/cats-pajamas -maxdepth 1 -type f -name "*.tar.gz" -printf "%f\n"')))
                $name = @($names | Where-Object { Test-BackupName ([string]$_) } | Sort-Object -Descending | Select-Object -First 1)
                if ($name.Count -ne 1) { throw 'No remote backup found' }
                $name = [string]$name[0]
                $stamp = Get-BackupTimestamp $name
                if ($stamp -lt [datetime]::UtcNow.AddHours(-$MaxAgeHours) -or $stamp -gt [datetime]::UtcNow.AddMinutes(10)) { throw 'Remote backup is stale or has an invalid date' }
                $hashOutput = @(Invoke-BackupTool $SshPath ($sshOptions + @('cats-pajamas', "sha256sum /var/backups/cats-pajamas/$name")))
                if ($hashOutput.Count -ne 1 -or [string]$hashOutput[0] -notmatch '^([a-fA-F0-9]{64})\s') { throw 'Invalid remote checksum' }
                $hash = $Matches[1]
                $target = Join-Path $Destination $name
                $verified = $false
                if (Test-Path -LiteralPath $target) {
                    try { Assert-BackupHash $target $hash; $verified = $true } catch { }
                }
                if (!$verified) {
                    $partial = Join-Path $Destination ($name + '.' + [guid]::NewGuid().ToString('N') + '.partial')
                    Invoke-BackupTool $ScpPath ($sshOptions + @('-q', "cats-pajamas:/var/backups/cats-pajamas/$name", $partial)) | Out-Null
                    Assert-BackupHash $partial $hash
                    if (Test-Path -LiteralPath $target) {
                        $replaced = $partial + '.replaced'
                        [IO.File]::Replace($partial, $target, $replaced)
                        Remove-Item -LiteralPath $replaced
                    }
                    else { Move-Item -LiteralPath $partial -Destination $target }
                    $partial = $null
                }
                Remove-ExpiredBackups $Destination ([datetime]::UtcNow.AddDays(-$RetentionDays)) $name
                $success = @{ checkedUtc=[datetime]::UtcNow.ToString('o'); archive=$name; sha256=$hash }
                $lastNotificationUtc = $null
                try { $lastNotificationUtc = (Get-Content -LiteralPath (Join-Path $Destination 'status.json') -Raw | ConvertFrom-Json).lastNotificationUtc } catch { }
                @{ ok=$true; checkedUtc=$success.checkedUtc; archive=$name; sha256=$hash; lastSuccess=$success; lastNotificationUtc=$lastNotificationUtc } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Destination 'status.json') -Encoding UTF8
                return
            } catch {
                $lastError = $_.Exception.Message
                if ($partial -and (Test-Path -LiteralPath $partial)) { Remove-Item -LiteralPath $partial; $partial = $null }
                if ($attempt -lt 3) { Start-Sleep -Seconds 10 }
            }
        }
        throw $lastError
    } finally { if ($lock) { $lock.Dispose() } }
}

if (!$LibraryOnly) {
    try { Invoke-BackupCollection; exit 0 }
    catch {
        # Fixed public error, with no captured remote command output or credentials.
        $message = 'Новая копия пока не сохранена. Прежние копии сохранены. Следующая попытка автоматически.'
        $safeStatusDirectory = $false
        try { Assert-BackupDirectory $Destination; $safeStatusDirectory = Test-Path -LiteralPath $Destination -PathType Container } catch { }
        if ($safeStatusDirectory) {
            $lastSuccess = $null
            $lastNotificationUtc = $null
            try {
                $previous = Get-Content -LiteralPath (Join-Path $Destination 'status.json') -Raw | ConvertFrom-Json
                $lastNotificationUtc = $previous.lastNotificationUtc
                $candidate = $previous.lastSuccess
                if (!$candidate -and $previous.ok) { $candidate = $previous }
                if ($candidate -and (Test-BackupName $candidate.archive) -and $candidate.sha256 -match '^[a-fA-F0-9]{64}$') {
                    $lastSuccess = @{ checkedUtc=$candidate.checkedUtc; archive=$candidate.archive; sha256=$candidate.sha256 }
                }
            } catch { }
            if (Test-BackupNotificationDue $lastNotificationUtc) {
                # Persist the attempt before showing: notification failures also remain quiet for 24 hours.
                $lastNotificationUtc = [datetime]::UtcNow.ToString('o')
                $notify = $true
            } else { $notify = $false }
            @{ ok=$false; checkedUtc=[datetime]::UtcNow.ToString('o'); error=$message; lastSuccess=$lastSuccess; lastNotificationUtc=$lastNotificationUtc } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Destination 'status.json') -Encoding UTF8
            if ($notify) { try { Show-BackupFailureToast $message } catch { } }
        }
        Write-Error $message -ErrorAction Continue
        exit 1
    }
}
