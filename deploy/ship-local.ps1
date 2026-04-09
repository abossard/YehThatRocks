param(
  [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$Branch = "main",
  [string]$VpsHost = $env:YTR_VPS_HOST,
  [string]$VpsRepoDir = "/srv/yehthatrocks",
  [string]$ImageBase = "yehthatrocks-web",
  [switch]$SkipGitPush
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Exec([string]$Command) {
  Write-Host "> $Command" -ForegroundColor Cyan
  Invoke-Expression $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $($LASTEXITCODE): $Command"
  }
}

if ([string]::IsNullOrWhiteSpace($VpsHost)) {
  throw "VpsHost is required. Set YTR_VPS_HOST or pass -VpsHost."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker CLI not found. Install Docker Desktop (WSL2 backend) to use local build+ship flow."
}

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  throw "ssh command not found. Install OpenSSH client."
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

  Write-Host "Building image locally with full progress output..." -ForegroundColor Yellow
  Exec "docker buildx build --platform linux/amd64 --progress=plain --load -t $imageTag -t $latestTag ."

  Write-Host "Streaming image directly to VPS (no registry)..." -ForegroundColor Yellow
  Exec "docker save $imageTag | ssh $VpsHost 'docker load'"

  $remoteDeploy = "cd $VpsRepoDir && git pull --ff-only origin $Branch && WEB_IMAGE=$imageTag SKIP_PULL=1 ./deploy/deploy-prod-hot-swap.sh"
  Write-Host "Triggering VPS hot-swap deploy..." -ForegroundColor Yellow
  Exec "ssh $VpsHost '$remoteDeploy'"

  Write-Host "Deploy complete: $imageTag" -ForegroundColor Green
} finally {
  Pop-Location
}
