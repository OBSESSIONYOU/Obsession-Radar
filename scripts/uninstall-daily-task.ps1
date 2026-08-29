# Removes the AI Radar Lite Daily Update scheduled task.
$taskName = "AI Radar Lite Daily Update"
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Output "Scheduled task '$taskName' removed."
} else {
  Write-Output "Scheduled task '$taskName' not found; nothing to remove."
}
