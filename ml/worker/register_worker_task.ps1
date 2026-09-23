# Register the local LoRA worker to start at logon (Task Scheduler). Run once; no admin rights needed.
#   powershell -ExecutionPolicy Bypass -File ml\worker\register_worker_task.ps1
# Remove:
#   Unregister-ScheduledTask -TaskName "gomijoshua-local-variant-worker" -Confirm:$false
# The task restarts the worker 1 minute after a crash. If the PC goes to sleep the worker
# stops too, so disable sleep on this PC separately.

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bat = Join-Path $Here "start_worker.bat"
$TaskName = "gomijoshua-local-variant-worker"

$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$Bat`"" -WorkingDirectory $Here
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
  -Description "gomijoshua local LoRA variant worker (MongoDB queue)" -Force | Out-Null
Write-Host "registered: $TaskName (starts at logon, restarts 1 min after a crash)"
