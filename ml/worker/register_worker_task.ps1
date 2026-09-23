# Register the local LoRA worker to start at logon (Task Scheduler). Run once; no admin rights needed.
#   powershell -ExecutionPolicy Bypass -File ml\worker\register_worker_task.ps1
# The worker runs with no window (pythonw), so closing a window cannot stop it by accident.
# Output goes to ml\worker\logs\worker.log. Network errors (e.g. right after logon) do not end it.
#   status : the admin page shows online/offline, or
#            Get-ScheduledTask -TaskName gomijoshua-local-variant-worker
#   stop   : Stop-ScheduledTask -TaskName gomijoshua-local-variant-worker   (stays stopped until start or next logon)
#   start  : Start-ScheduledTask -TaskName gomijoshua-local-variant-worker
#   remove : Unregister-ScheduledTask -TaskName gomijoshua-local-variant-worker -Confirm:$false
# Task Scheduler does NOT restart the worker after it exits; its restart setting only covers a failed launch.
# Sleep pauses the worker too, so disable sleep on this PC separately.

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Venv = $env:LOCAL_VARIANT_VENV
if (-not $Venv) { $Venv = Join-Path $Here "..\topic\windows\.venv" }
$Pythonw = Join-Path $Venv "Scripts\pythonw.exe"
if (-not (Test-Path $Pythonw)) { throw "pythonw.exe not found: $Pythonw -- run ml\topic\windows\setup.bat first" }
$Pythonw = (Resolve-Path $Pythonw).Path
$Script = Join-Path $Here "local_variant_worker.py"
$Log = Join-Path $Here "logs\worker.log"
$TaskName = "gomijoshua-local-variant-worker"

$Action = New-ScheduledTaskAction -Execute $Pythonw -Argument "`"$Script`" --log-file `"$Log`"" -WorkingDirectory $Here
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
  -Description "gomijoshua local LoRA variant worker (MongoDB queue). No window; log: $Log" -Force | Out-Null
Write-Host "registered: $TaskName (starts at logon, no window, log: $Log)"
Write-Host "start now : Start-ScheduledTask -TaskName $TaskName"
