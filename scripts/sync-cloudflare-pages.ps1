# Syncs the clean Cloudflare Pages publish directory (.cloudflare-pages).
# Deploy that directory only: npx wrangler pages deploy .\.cloudflare-pages --project-name=obsession-radar
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
Set-Location $root

$target = Join-Path $root ".cloudflare-pages"
if (-not (Test-Path $target)) { New-Item -ItemType Directory -Path $target | Out-Null }

$staticFiles = @(
  "index.html",
  "radar-core.browser.js",
  "radar-fetchers.browser.js",
  "paper-library.browser.js",
  "topic-radar-store.browser.js",
  "ai-api-config.browser.js",
  "app.js",
  "demo-data.js",
  "last-run-data.js",
  "daily-radar.json",
  "daily-radar.md",
  "README.md"
)

foreach ($file in $staticFiles) {
  $source = Join-Path $root $file
  if (Test-Path $source) {
    Copy-Item $source (Join-Path $target $file) -Force
  } else {
    Write-Warning "Missing file, skipped: $file"
  }
}

# Pages Functions are served from the functions/ directory at the publish root.
$functionsSource = Join-Path $root "functions"
$functionsTarget = Join-Path $target "functions"
if (Test-Path $functionsTarget) { Remove-Item $functionsTarget -Recurse -Force }
Copy-Item $functionsSource $functionsTarget -Recurse -Force

Write-Output "Synced publish directory: $target"
Get-ChildItem $target | Format-Table Name, Length
