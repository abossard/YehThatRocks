param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

function Test-IsAdmin {
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-OpenSshServerInstalled {
  $sshdService = Get-Service -Name sshd -ErrorAction SilentlyContinue
  if ($sshdService) {
    return $true
  }

  if (-not (Test-IsAdmin)) {
    Write-Error @"
OpenSSH Server (sshd) is not installed.

Please run this once in an elevated PowerShell (Run as Administrator):
  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

Then rerun:
  npm run tunnel:host
"@
    return $false
  }

  Write-Host "OpenSSH Server not found. Attempting installation..."
  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null

  $sshdService = Get-Service -Name sshd -ErrorAction SilentlyContinue
  if (-not $sshdService) {
    Write-Error "OpenSSH Server installation did not complete successfully. Install it from Settings > Optional Features and rerun."
    return $false
  }

  Write-Host "OpenSSH Server installed successfully."
  return $true
}

Write-Host "Preparing Windows SSH host for Linux localhost tunneling..."

if (-not (Ensure-OpenSshServerInstalled)) {
  exit 1
}

$sshdService = Get-Service -Name sshd -ErrorAction SilentlyContinue

if (-not (Test-IsAdmin)) {
  Write-Host ""
  Write-Warning "OpenSSH Server is installed, but this script needs Administrator rights to start/configure sshd and firewall rules."
  Write-Host ""
  Write-Host "Run these once in an elevated PowerShell (Run as Administrator):"
  Write-Host "  Start-Service sshd"
  Write-Host "  Set-Service -Name sshd -StartupType Automatic"
  Write-Host "  if (-not (Get-NetFirewallRule -DisplayName 'OpenSSH Server (TCP-In)' -ErrorAction SilentlyContinue)) {"
  Write-Host "    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (TCP-In)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22"
  Write-Host "  }"
  Write-Host ""
  Write-Host "Then rerun: npm run tunnel:host"
  exit 1
}

if ($sshdService.Status -ne "Running") {
  Start-Service sshd
  Write-Host "Started sshd service."
}

Set-Service -Name sshd -StartupType Automatic
Write-Host "Configured sshd startup type to Automatic."

$firewallRuleName = "OpenSSH Server (TCP-In)"
$existingRule = @(Get-NetFirewallRule -DisplayName $firewallRuleName -ErrorAction SilentlyContinue)

if (-not $existingRule -or $existingRule.Count -eq 0) {
  $existingRule = @(Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue)
}

if (-not $existingRule) {
  try {
    New-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -DisplayName $firewallRuleName -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
    Write-Host "Created firewall rule for SSH on port 22."
  } catch {
    if ($_.Exception.Message -like "*already exists*" -or $_.Exception.Message -like "*Error 183*") {
      Write-Host "Firewall rule for SSH already exists."
    } else {
      throw
    }
  }
} else {
  Write-Host "Firewall rule for SSH already exists."
}

$ipv4 = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -notlike "169.254.*" -and
    $_.IPAddress -ne "127.0.0.1" -and
    $_.PrefixOrigin -ne "WellKnown"
  } |
  Select-Object -First 1 -ExpandProperty IPAddress)

if (-not $ipv4) {
  Write-Warning "Could not detect a LAN IPv4 automatically. Use your machine IP manually on Linux."
} else {
  Write-Host "Detected Windows host LAN IP: $ipv4"
}

Write-Host ""
Write-Host "Next steps on Linux test machine:"
Write-Host "  chmod +x scripts/linux-localhost-tunnel.sh"
if ($ipv4) {
  Write-Host "  ./scripts/linux-localhost-tunnel.sh <windows-user> $ipv4 $Port $Port"
} else {
  Write-Host "  ./scripts/linux-localhost-tunnel.sh <windows-user> <windows-lan-ip> $Port $Port"
}
Write-Host ""
Write-Host "Then browse on Linux: http://localhost:$Port"
