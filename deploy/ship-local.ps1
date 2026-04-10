param(
  [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$Branch = "main",
  [string]$VpsHost = $(if ($env:YTR_VPS_HOST) { $env:YTR_VPS_HOST } else { "root@206.189.122.114" }),
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
    throw ("Command failed with exit code {0}; command {1}" -f $LASTEXITCODE, $Command)
  }
}

function ExecNative([string]$Program, [string[]]$CommandArgs) {
  $display = "$Program " + ($CommandArgs -join " ")
  Write-Host "> $display" -ForegroundColor Cyan
  & $Program @CommandArgs
  if ($LASTEXITCODE -ne 0) {
    throw ("Command failed with exit code {0}; command {1}" -f $LASTEXITCODE, $display)
  }
}

function Ensure-DockerDaemon {
  $dockerInfoOutput = & docker info 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0) {
    return
  }

  if ($dockerInfoOutput -match "dockerDesktopLinuxEngine" -or
      $dockerInfoOutput -match "The system cannot find the file specified" -or
      $dockerInfoOutput -match "error during connect" -or
      $dockerInfoOutput -match "Cannot connect to the Docker daemon") {
    throw @"
Docker daemon is not reachable.

On Windows this usually means Docker Desktop is not running (or has not finished starting).
1) Start Docker Desktop
2) Wait until it shows "Engine running"
3) Retry this command

Raw docker info error:
$dockerInfoOutput
"@
  }

  throw ("Docker daemon check failed.`n`nRaw docker info error:`n{0}" -f $dockerInfoOutput)
}

function Ensure-CleanGitWorktree {
  $statusOutput = (& git status --porcelain) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to determine git worktree status."
  }

  if (-not [string]::IsNullOrWhiteSpace($statusOutput)) {
    throw @"
Working tree is not clean. Commit or stash your changes before running ship.

Pending changes:
$statusOutput
"@
  }
}

function Transfer-ImageToVps([string]$ImageTag, [string]$VpsHost) {
  $tempDir = [System.IO.Path]::GetTempPath()
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $safeTag = ($ImageTag -replace "[^a-zA-Z0-9_.-]", "_")
  $localTarPath = Join-Path $tempDir ("ytr-{0}-{1}.tar" -f $safeTag, $timestamp)
  $remoteTarPath = "/tmp/yehthatrocks-image-{0}.tar" -f $timestamp

  try {
    Write-Host "Saving local image tar archive..." -ForegroundColor Yellow
    ExecNative -Program "docker" -CommandArgs @("save", "-o", $localTarPath, $ImageTag)

    Write-Host "Uploading image archive to VPS..." -ForegroundColor Yellow
    ExecNative -Program "scp" -CommandArgs @($localTarPath, "$VpsHost`:$remoteTarPath")

    Write-Host "Loading uploaded image on VPS..." -ForegroundColor Yellow
    $remoteLoad = "set -e; trap 'rm -f $remoteTarPath' EXIT; docker load -i $remoteTarPath"
    ExecNative -Program "ssh" -CommandArgs @($VpsHost, $remoteLoad)
  } finally {
    if (Test-Path $localTarPath) {
      Remove-Item -Force $localTarPath -ErrorAction SilentlyContinue
    }
  }
}

if ([string]::IsNullOrWhiteSpace($VpsHost)) {
  $VpsHost = (Read-Host "Enter VPS SSH host (example: root@ubuntu-s-1vcpu-1gb-lon1-01)").Trim()
  if ([string]::IsNullOrWhiteSpace($VpsHost)) {
    throw "VpsHost is required. Set YTR_VPS_HOST or pass -VpsHost."
  }

  if ($VpsHost -notmatch "@") {
    $VpsHost = "root@$VpsHost"
  }

  # Persist for future no-flag runs.
  & setx YTR_VPS_HOST $VpsHost | Out-Null
  $env:YTR_VPS_HOST = $VpsHost
  Write-Host "Saved YTR_VPS_HOST for future runs: $VpsHost" -ForegroundColor Green
}

if ($VpsHost -notmatch "@") {
  $VpsHost = "root@$VpsHost"
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker CLI not found. Install Docker Desktop (WSL2 backend) to use local build+ship flow."
}

Ensure-DockerDaemon

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  throw "ssh command not found. Install OpenSSH client."
}

if (-not (Get-Command scp -ErrorAction SilentlyContinue)) {
  throw "scp command not found. Install OpenSSH client with scp support."
}

Push-Location $RepoDir
try {
  Ensure-CleanGitWorktree

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
  Exec "docker build --progress=plain -t $imageTag -t $latestTag ."

  Write-Host "Transferring image to VPS (no registry)..." -ForegroundColor Yellow
  Transfer-ImageToVps -ImageTag $imageTag -VpsHost $VpsHost

  $remoteDeploy = "cd $VpsRepoDir && git pull --ff-only origin $Branch && WEB_IMAGE=$imageTag SKIP_PULL=1 ./deploy/deploy-prod-hot-swap.sh"
  Write-Host "Triggering VPS hot-swap deploy..." -ForegroundColor Yellow
  Exec "ssh $VpsHost '$remoteDeploy'"

  Write-Host "Deploy complete: $imageTag" -ForegroundColor Green
} finally {
  Pop-Location
}
