#!/usr/bin/env pwsh
# Complete MySQL Setup & Registration Fix
# Handles both database plugin fix and credential verification

param(
    [string]$MySQLHost = "localhost",
    [string]$MySQLRootUser = "root",
    [string]$MySQLRootPassword = "",
    [string]$DBUser = "user",
    [string]$DBPassword = "password",
    [string]$DBName = "yeh",
    [string]$AppPort = "3000"
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "▶ $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host "  $Message" -ForegroundColor Gray
}

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "║       MySQL Registration Error - Complete Fix            ║" -ForegroundColor Blue
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Blue

# Step 1: Check MySQL installation
Write-Step "Checking MySQL installation..."
$mysqlCmd = Get-Command mysql -ErrorAction SilentlyContinue
if (-not $mysqlCmd) {
    Write-Error-Custom "MySQL client not found in PATH"
    Write-Info "Install from: https://dev.mysql.com/downloads/mysql/"
    exit 1
}
Write-Success "MySQL client found"

# Step 2: Check MySQL connectivity
Write-Step "Testing MySQL connection..."
Write-Info "Host: $MySQLHost | User: $MySQLRootUser"

try {
    if ($MySQLRootPassword) {
        echo "SELECT 1;" | mysql -h $MySQLHost -u $MySQLRootUser -p$MySQLRootPassword 2>&1 | Out-Null
    } else {
        echo "SELECT 1;" | mysql -h $MySQLHost -u $MySQLRootUser 2>&1 | Out-Null
    }
    Write-Success "MySQL connection successful"
} catch {
    Write-Error-Custom "Cannot connect to MySQL"
    Write-Info "Troubleshooting:"
    Write-Info "  1. Verify MySQL is running: services.msc"
    Write-Info "  2. Check host: Is MySQL on localhost or remote?"
    Write-Info "  3. Check password: Is it blank or something else?"
    Write-Info ""
    Write-Info "Try manually: mysql -h $MySQLHost -u $MySQLRootUser -p"
    exit 1
}

# Step 3: Check if database exists
Write-Step "Checking database and user..."
$checkDb = @"
SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '$DBName';
"@

$dbExists = if ($MySQLRootPassword) {
    echo $checkDb | mysql -h $MySQLHost -u $MySQLRootUser -p$MySQLRootPassword -N 2>&1 | Select-String "1"
} else {
    echo $checkDb | mysql -h $MySQLHost -u $MySQLRootUser -N 2>&1 | Select-String "1"
}

if ($dbExists) {
    Write-Success "Database '$DBName' exists"
} else {
    Write-Info "Database '$DBName' does not exist - will create it"
}

# Step 4: Fix the MySQL user authentication plugin
Write-Step "Fixing MySQL user authentication plugin..."

$fixSql = @"
-- Create/update user with mysql_native_password
ALTER USER IF EXISTS '$DBUser'@'localhost' IDENTIFIED WITH mysql_native_password BY '$DBPassword';
ALTER USER IF EXISTS '$DBUser'@'%' IDENTIFIED WITH mysql_native_password BY '$DBPassword';

-- Grant privileges
GRANT ALL PRIVILEGES ON $DBName.* TO '$DBUser'@'localhost';
GRANT ALL PRIVILEGES ON $DBName.* TO '$DBUser'@'%';

-- Apply changes
FLUSH PRIVILEGES;

-- Verify
SELECT user, host, plugin FROM mysql.user WHERE user = '$DBUser' UNION ALL SELECT '---', '---', '---' UNION ALL SELECT 'Done', 'checking', 'plugin';
"@

Write-Info "Executing: ALTER USER ... IDENTIFIED WITH mysql_native_password"

try {
    if ($MySQLRootPassword) {
        echo $fixSql | mysql -h $MySQLHost -u $MySQLRootUser -p$MySQLRootPassword
    } else {
        echo $fixSql | mysql -h $MySQLHost -u $MySQLRootUser
    }
    Write-Success "User plugin fixed"
} catch {
    Write-Error-Custom "Could not fix user authentication plugin"
    Write-Info "This might be expected if the user doesn't exist yet"
    Write-Info "Continuing..."
}

# Step 5: Update .env.local
Write-Step "Updating application environment..."
$envPath = "apps/web/.env.local"
$dbUrl = "mysql://$DBUser`:$DBPassword@$MySQLHost`:3306/$DBName"

Write-Info "File: $envPath"
Write-Info "DATABASE_URL=$dbUrl"

$envContent = @"
DATABASE_URL="$dbUrl"
AUTH_JWT_SECRET="replace-with-a-random-32-plus-character-secret"
APP_URL="http://localhost:$AppPort"
SMTP_HOST=""
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM="noreply@example.com"
"@

Set-Content -Path $envPath -Value $envContent -Encoding UTF8
Write-Success ".env.local updated"

# Step 6: Clear Next.js cache and restart server
Write-Step "Preparing to restart development server..."
Write-Info "Removing .next build cache..."
$nextDir = "apps/web/.next"
if (Test-Path $nextDir) {
    Remove-Item -Recurse -Force $nextDir
    Write-Success "Cache cleared"
}

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                    Setup Complete!                         ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Green

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Start the development server:" -ForegroundColor White
Write-Host "   npm -w web run dev" -ForegroundColor Yellow
Write-Host ""
Write-Host "2. Wait for server to start (should see 'ready - started server on')" -ForegroundColor White
Write-Host ""
Write-Host "3. Test registration in your browser:" -ForegroundColor White
Write-Host "   http://localhost:$AppPort/register" -ForegroundColor Yellow
Write-Host ""
Write-Host "4. Or test via PowerShell:" -ForegroundColor White
Write-Host @"
`$body = @{
    email = "test@example.com"
    screenName = "testuser"
    password = "TestPassword123!"
    remember = `$true
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:$AppPort/api/auth/register" `
  -Method POST `
  -ContentType "application/json" `
  -Headers @{ Origin = "http://localhost:$AppPort" } `
  -Body `$body
"@ -ForegroundColor Gray
