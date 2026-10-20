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
# GitHub's scheduled workflow can start hours late. Keep checking after a
# successful morning collection so today's export is collected when it arrives.
$trigger.Repetition = New-CimInstance -Namespace 'root/Microsoft/Windows/TaskScheduler' -ClassName 'MSFT_TaskRepetitionPattern' -ClientOnly -Property @{ Interval='PT2H'; Duration='P1D'; StopAtDurationEnd=$false }
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'CatsPajamas-OffServerBackup' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Verified encrypted GitHub backup collection every two hours from 08:45 local time; runs while signed in, with bounded failure retries.' -Force | Out-Null
Write-Output 'Replaced CatsPajamas-OffServerBackup: every two hours from 08:45 local time, current signed-in user, missed starts and bounded failure retries enabled.'
