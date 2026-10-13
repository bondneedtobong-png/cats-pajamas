param([string]$Destination = 'C:\Users\bond\mcp\cats-pajamas-backups')
$ErrorActionPreference = 'Stop'
$collector = Join-Path $PSScriptRoot 'backup-collect.ps1'
if (!(Test-Path -LiteralPath $collector -PathType Leaf)) { throw 'Backup collector missing' }
. $collector -LibraryOnly -Destination $Destination
Assert-BackupDirectory $Destination
# Refuse broad ACL changes even for otherwise canonical absolute paths.
if ($Destination.TrimEnd('\','/') -match '^[A-Za-z]:\\(?:Users(?:\\[^\\]+)?|Windows|Program Files(?: \(x86\))?)$') { throw 'Refusing ACL changes on a system or profile root' }
if ($collector.Contains('"')) { throw 'Unsafe collector path' }
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
Set-BackupDirectoryAccess $Destination
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $collector + '" -Destination "' + $Destination + '"'
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $arguments
# VPS generates at 03:30 UTC; Europe/Samara is UTC+4. Allow 30 minutes to finish.
$trigger = New-ScheduledTaskTrigger -Daily -At '08:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'CatsPajamas-OffServerBackup' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Verified daily VPS backup copy; runs when this user is signed in.' -Force | Out-Null
Write-Output 'Installed CatsPajamas-OffServerBackup at 08:00 local time; runs while signed in, catches missed starts.'
