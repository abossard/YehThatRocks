param(
  [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$ImageBase = "ghcr.io/simonjamesodell/yehthatrocks-web",
  [string]$Branch = "main",
  [string]$VpsHost = $env:YTR_VPS_HOST,
  [string]$VpsRepoDir = "/srv/yehthatrocks",
  [switch]$PrepareOnly,
  [switch]$SkipGitPush
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Exec([string]$Command) {
  Write-Host "> $Command" -ForegroundColor Cyan
  Invoke-Expression $Command
}

if (-not $PrepareOnly -and [string]::IsNullOrWhiteSpace($VpsHost)) {
  throw "VpsHost is required unless -PrepareOnly is set. Set YTR_VPS_HOST or pass -VpsHost."
}

Push-Location $RepoDir
try {
  Exec "git fetch origin $Branch"
  Exec "git checkout $Branch"

  if (-not $SkipGitPush) {
    Exec "git push origin $Branch"
  }

  $sha = (git rev-parse --short HEAD).Trim()
  if ([string]::IsNullOrWhiteSpace($sha)) {
    throw "Could not determine git commit SHA"
  }

  $imageTag = "$ImageBase`:$sha"
  $latestTag = "$ImageBase`:latest"

  Exec "docker buildx build --platform linux/amd64 -t $imageTag -t $latestTag --push ."

  if ($PrepareOnly) {
    Write-Host "Image pushed: $imageTag" -ForegroundColor Green
    Write-Host "Run on VPS: WEB_IMAGE=$imageTag deploy" -ForegroundColor Yellow
    exit 0
  }

  $remoteCommand = "cd $VpsRepoDir && WEB_IMAGE=$imageTag ./deploy/deploy-prod-hot-swap.sh"
  Exec "ssh $VpsHost '$remoteCommand'"

  Write-Host "Deploy complete: $imageTag" -ForegroundColor Green
} finally {
  Pop-Location
}
