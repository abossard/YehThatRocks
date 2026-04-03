#!/usr/bin/env pwsh
# MySQL User Authentication Plugin Fix
# This script fixes the sha256_password error by converting to mysql_native_password

param(
    [string]$MySQLHost = "localhost",
    [string]$MySQLUser = "root",
    [string]$MySQLPassword = "",
    [string]$TargetUser = "user",
    [string]$TargetPassword = "password",
    [string]$TargetHost = "%"
)

Write-Host "MySQL Authentication Plugin Fix" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Check if mysql command is available
$mysqlCmd = Get-Command mysql -ErrorAction SilentlyContinue
if (-not $mysqlCmd) {
    Write-Host "ERROR: 'mysql' command not found. Please install MySQL Client Tools." -ForegroundColor Red
    Write-Host "Download from: https://dev.mysql.com/downloads/shell/" -ForegroundColor Yellow
    exit 1
}

Write-Host "Connecting to MySQL server: $MySQLHost as $MySQLUser..." -ForegroundColor Yellow

# Build connection string
$connSpecifier = "$MySQLUser@$MySQLHost"

# Prepare SQL commands
$sqlCommands = @"
ALTER USER '$TargetUser'@'$TargetHost' IDENTIFIED WITH mysql_native_password BY '$TargetPassword';
FLUSH PRIVILEGES;
SELECT user, host, plugin FROM mysql.user WHERE user = '$TargetUser';
"@

Write-Host "Executing fix for user: $TargetUser@$TargetHost" -ForegroundColor Yellow
Write-Host ""

# Execute the fix
if ($MySQLPassword) {
    echo $sqlCommands | mysql -h $MySQLHost -u $MySQLUser -p$MySQLPassword
} else {
    echo $sqlCommands | mysql -h $MySQLHost -u $MySQLUser
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "SUCCESS: MySQL user authentication plugin updated!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Verify DATABASE_URL in apps/web/.env.local has correct credentials:" -ForegroundColor White
    Write-Host "   DATABASE_URL=mysql://$TargetUser:$TargetPassword@$MySQLHost:3306/yeh" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. Restart the dev server:" -ForegroundColor White
    Write-Host "   npm -w web run dev" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. Test registration again" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "FAILED: Could not execute MySQL commands." -ForegroundColor Red
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "- Verify MySQL is running" -ForegroundColor Gray
    Write-Host "- Check host is correct (use 'localhost' or '127.0.0.1' for local)" -ForegroundColor Gray
    Write-Host "- Verify root password is correct" -ForegroundColor Gray
    Write-Host "- Run manually: mysql -h $MySQLHost -u $MySQLUser -p < fix-mysql-user.sql" -ForegroundColor Gray
    exit 1
}
