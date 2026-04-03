[CmdletBinding()]
param(
  [int]$Limit = 1000,
  [int]$Concurrency = 8,
  [int]$Retries = 2,
  [int]$WriteRetries = 6,
  [int]$DbChunkMultiplier = 3,
  [switch]$Resume,
  [string]$CheckpointFile,
  [switch]$PoolOnly,
  [switch]$NoExhaustive,
  [switch]$Fast,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

if ($Fast) {
  if ($PSBoundParameters.ContainsKey("Limit") -eq $false) { $Limit = 2000 }
  if ($PSBoundParameters.ContainsKey("Concurrency") -eq $false) { $Concurrency = 12 }
  if ($PSBoundParameters.ContainsKey("DbChunkMultiplier") -eq $false) { $DbChunkMultiplier = 4 }
  if ($PSBoundParameters.ContainsKey("WriteRetries") -eq $false) { $WriteRetries = 8 }
}

$allArg = if ($PoolOnly) { "" } else { "--all" }
$exhaustiveArg = if ($NoExhaustive) { "" } else { "--exhaustive" }

$envFile = Join-Path $repoRoot "apps/web/.env.local"
if (-not $env:DATABASE_URL -and (Test-Path $envFile)) {
  $dbLine = Get-Content $envFile | Select-String '^DATABASE_URL=' | Select-Object -First 1
  if ($dbLine) {
    $value = ($dbLine.Line -replace '^DATABASE_URL="?', '') -replace '"?$', ''
    if ($value) {
      $env:DATABASE_URL = $value
    }
  }
}

if (-not $env:DATABASE_URL) {
  throw "DATABASE_URL is not set and could not be read from apps/web/.env.local"
}

$logsDir = Join-Path $repoRoot "logs"
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$scope = if ($PoolOnly) { "pool" } else { "all" }
$mode = if ($NoExhaustive) { "single" } else { "exhaustive" }
$logPath = Join-Path $logsDir "embed-audit-$scope-$mode-$timestamp.log"

if (-not $CheckpointFile) {
  $CheckpointFile = Join-Path $logsDir "embed-audit-$scope-$mode.checkpoint.json"
}

$arguments = @("scripts/audit-video-embedability.js")
if ($allArg) { $arguments += $allArg }
if ($exhaustiveArg) { $arguments += $exhaustiveArg }
$arguments += @(
  "--limit=$Limit",
  "--concurrency=$Concurrency",
  "--retries=$Retries",
  "--writeRetries=$WriteRetries",
  "--dbChunkMultiplier=$DbChunkMultiplier",
  "--checkpointFile=$CheckpointFile"
)
if ($Resume) { $arguments += "--resume" }

Write-Host "Starting embed audit..." -ForegroundColor Cyan
Write-Host "Engine: cursor-pagination-v3" -ForegroundColor DarkCyan
Write-Host "Limit: $Limit  Concurrency: $Concurrency  Retries: $Retries  WriteRetries: $WriteRetries  DbChunkMultiplier: $DbChunkMultiplier" -ForegroundColor Gray
Write-Host "Scope: $scope  Mode: $mode" -ForegroundColor Gray
Write-Host "Log: $logPath" -ForegroundColor Gray
Write-Host "Checkpoint: $CheckpointFile  Resume: $Resume" -ForegroundColor Gray

if ($DryRun) {
  Write-Host "Dry run command:" -ForegroundColor Yellow
  Write-Host "node $($arguments -join ' ')" -ForegroundColor Yellow
  exit 0
}

$ErrorActionPreference = 'SilentlyContinue'
& node @arguments 2>&1 | Tee-Object -FilePath $logPath
$exitCode = $LASTEXITCODE
$ErrorActionPreference = 'Continue'

Write-Host "Audit finished with exit code $exitCode" -ForegroundColor Cyan
if ($exitCode -ne 0) {
  exit $exitCode
}
