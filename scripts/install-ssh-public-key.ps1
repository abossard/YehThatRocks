param(
  [string]$PublicKey = ""
)

$ErrorActionPreference = "Stop"

function Test-IsAdmin {
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
  Write-Host "Re-launching as Administrator..."
  $scriptPath = $MyInvocation.MyCommand.Path
  $argList = "-ExecutionPolicy Bypass -File `"$scriptPath`""
  if ($PublicKey) {
    $argList += " -PublicKey `"$PublicKey`""
  }
  Start-Process powershell -Verb RunAs -ArgumentList $argList -Wait
  exit
}

if (-not $PublicKey) {
  $PublicKey = Read-Host "Paste the Linux public key (ssh-ed25519 ...)"
}

if (-not $PublicKey.StartsWith("ssh-")) {
  Write-Error "That does not look like a valid SSH public key. It should start with ssh-ed25519 or ssh-rsa."
}

$targetFile = "C:\ProgramData\ssh\administrators_authorized_keys"

New-Item -ItemType File -Path $targetFile -Force | Out-Null
Set-Content -Path $targetFile -Value $PublicKey -Encoding UTF8

# Required: sshd only accepts this file if owned by Administrators/SYSTEM, no other ACEs
icacls $targetFile /inheritance:r | Out-Null
icacls $targetFile /grant "Administrators:(F)" | Out-Null
icacls $targetFile /grant "SYSTEM:(F)" | Out-Null

Write-Host ""
Write-Host "Public key installed to $targetFile"
Write-Host "Restarting sshd..."

Restart-Service sshd

Write-Host ""
Write-Host "Done. Test from Linux:"
Write-Host "  ssh simon@<windows-lan-ip> `"echo key-auth-ok`""
Write-Host ""
Write-Host "(Press Enter to close)"
Read-Host | Out-Null
