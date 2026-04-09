param(
  [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$profilePath = $PROFILE.CurrentUserAllHosts
$profileDir = Split-Path -Parent $profilePath

if (-not (Test-Path $profileDir)) {
  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
}

if (-not (Test-Path $profilePath)) {
  New-Item -ItemType File -Path $profilePath -Force | Out-Null
}

$functionBlock = @"
function ship {
  param()
  powershell -NoProfile -ExecutionPolicy Bypass -File '$RepoDir\\deploy\\ship-local.ps1'
}
"@

$existing = Get-Content -Raw -Path $profilePath
if ($existing -notmatch "function\s+ship\s*\{") {
  Add-Content -Path $profilePath -Value "`r`n$functionBlock`r`n"
  Write-Host "Added 'ship' function to $profilePath" -ForegroundColor Green
} else {
  Write-Host "'ship' function already exists in $profilePath" -ForegroundColor Yellow
}

Write-Host "Restart PowerShell, then run: ship" -ForegroundColor Cyan
