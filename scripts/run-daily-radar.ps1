# Runs the daily radar update: node run-demo.mjs, logs to logs\YYYY-MM-DD.log,
# writes last-run.json + last-run-data.js, validates output, and opens the page.
param(
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
Set-Location $root

$startedAt = Get-Date
$logDir = Join-Path $root "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir ((Get-Date -Format "yyyy-MM-dd") + ".log")

function Write-Log([string]$message) {
  $line = "[{0:HH:mm:ss}] {1}" -f (Get-Date), $message
  Write-Output $line
  Add-Content -Path $logFile -Value $line
}

function Write-LastRun([bool]$ok, [int]$exitCode, [string]$message) {
  $finishedAt = Get-Date
  $relativeLog = "logs/" + (Split-Path -Leaf $logFile)
  $lastRun = [ordered]@{
    startedAt  = $startedAt.ToString("yyyy-MM-ddTHH:mm:ss.ffffffzzz")
    finishedAt = $finishedAt.ToString("yyyy-MM-ddTHH:mm:ss.ffffffzzz")
    ok         = $ok
    exitCode   = $exitCode
    message    = $message
    logFile    = $relativeLog
    openedPage = (-not $NoOpen)
  }
  $json = $lastRun | ConvertTo-Json
  Set-Content -Path (Join-Path $root "last-run.json") -Value $json -Encoding UTF8
  $js = "window.AGENTS_RADAR_LITE_LAST_RUN = " + $json + ";"
  Set-Content -Path (Join-Path $root "last-run-data.js") -Value $js -Encoding UTF8
}

Write-Log "Daily radar update started."
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Log "node not found in PATH."
  Write-LastRun $false 1 "node not found in PATH."
  exit 1
}

& node .\run-demo.mjs *>> $logFile
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
  Write-Log "run-demo.mjs failed with exit code $exitCode."
  Write-LastRun $false $exitCode "Daily radar update failed."
  exit $exitCode
}

# Validate the main leaderboard 30/5 and paper leaderboard 15/5 when present.
$radar = Get-Content .\daily-radar.json -Raw | ConvertFrom-Json
$mainCandidates = @($radar.candidates).Count
$mainRecommendations = @($radar.recommendations).Count
$paperCandidates = @($radar.paperRadar.candidates).Count
$paperRecommendations = @($radar.paperRadar.recommendations).Count
Write-Log "main $mainCandidates/$mainRecommendations, papers $paperCandidates/$paperRecommendations"

if ($mainCandidates -eq 0 -or $paperCandidates -eq 0) {
  Write-Log "Validation failed: radar output is empty."
  Write-LastRun $false 2 "Daily radar validation failed: empty output."
  exit 2
}

# Sync the clean Cloudflare Pages publish directory so the next deploy is fresh.
try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\sync-cloudflare-pages.ps1 *>> $logFile
} catch {
  Write-Log "sync-cloudflare-pages.ps1 failed: $($_.Exception.Message)"
}

Write-Log "Daily radar updated successfully."
Write-LastRun $true 0 "Daily radar updated successfully."

if (-not $NoOpen) {
  Start-Process (Join-Path $root "index.html")
}
exit 0
