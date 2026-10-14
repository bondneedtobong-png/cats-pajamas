param([string]$Destination = 'C:\Users\bond\mcp\cats-pajamas-backups')
$ErrorActionPreference = 'Stop'
$collector = Join-Path $PSScriptRoot 'backup-github-collect.ps1'
. $collector -LibraryOnly -Destination $Destination
Assert-BackupDirectory $Destination
if ($Destination.TrimEnd('\','/') -match '^[A-Za-z]:\\(?:Users(?:\\[^\\]+)?|Windows|Program Files(?: \(x86\))?)$') { throw 'Refusing ACL changes on a system or profile root' }
if ($collector.Contains('"')) { throw 'Unsafe collector path' }
if (!(Test-Path -LiteralPath (Join-Path $Destination 'cats-backup-decryption-key.pem') -PathType Leaf)) { throw 'Existing recovery key missing' }
Set-BackupDirectoryAccess $Destination
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $collector + '" -Destination "' + $Destination + '"'
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At '08:45'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'CatsPajamas-OffServerBackup' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Verified encrypted GitHub backup collection at 08:45 local time; runs while signed in.' -Force | Out-Null
Write-Output 'Replaced CatsPajamas-OffServerBackup: 08:45 local time, current signed-in user, missed starts caught automatically.'
