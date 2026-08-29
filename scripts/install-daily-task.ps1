# Installs a Windows scheduled task that runs the daily radar update.
# Default: every day at 08:30, opens the page after updating.
param(
  [string]$At = "08:30",
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$taskName = "AI Radar Lite Daily Update"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent

$script = Join-Path $root "scripts\run-daily-radar.ps1"
if (-not (Test-Path $script)) { throw "run-daily-radar.ps1 not found at $script" }

$argument = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
if ($NoOpen) { $argument += " -NoOpen" }

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Output "Removed existing task '$taskName'."
}

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Obsession Radar daily update" | Out-Null
Write-Output "Scheduled task '$taskName' installed: daily at $At."
Get-ScheduledTask -TaskName $taskName | Format-List TaskName, State
