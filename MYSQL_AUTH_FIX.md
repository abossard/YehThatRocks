# MySQL Authentication Plugin Issue - Solutions

## The Problem
Your MariaDB 12.2 installation uses `caching_sha2_password` and `sha256_password` authentication plugins by default. Prisma's MySQL connector doesn't support these plugins and requires `mysql_native_password`.

## Why This Happened
- MariaDB 12.2 and MySQL 8.0+ default to SHA-256 encryption for security
- Prisma was built to support legacy `mysql_native_password` plugin
- The two are incompatible without additional configuration

## Solution Options

### Option 1: Use MySQL 5.7 (Easiest for Quick Testing)
MySQL 5.7 uses `mysql_native_password` by default and is fully compatible with Prisma.

**Steps:**
1. Uninstall MariaDB 12.2
2. Download and install MySQL 5.7 Community Edition from https://dev.mysql.com/downloads/mysql/5.7.html
3. Run through installer with default settings
4. Update `apps/web/.env.local`:
```
DATABASE_URL="mysql://user:password@localhost:3306/yeh"
```
5. Restart dev server: `npm -w web run dev`

### Option 2: Downgrade MariaDB to 10.5 LTS
MariaDB 10.5 uses more compatible authentication plugins.

**Steps:**
1. Uninstall MariaDB 12.2
2. Download MariaDB 10.5 LTS from https://mariadb.org/download/
3. Install with default settings (will ask to configure authentication)
4. During setup, choose the option for compatibility
5. Proceed with application testing

### Option 3: Update Prisma to Support Modern Authentication (For Advanced Users)

Check if a newer Prisma version supports your plugins:

```bash
npm install @prisma/client@latest
npm run prisma:generate
```

Then retry registration.

### Option 4: Configure MariaDB with Compatibility Mode  
Try enabling password_reuse_check plugin or modifying MySQL config:

```sql
ALTER SYSTEM SET default_authentication_plugin = 'socket_auth';
-- or
INSTALL PLUGIN mariadb_native_password SONAME 'ma_auth_ed25519';
```

**Note:** This is advanced and may not work depending on your MariaDB build.

## Current Status
✅ Database created: `yeh`  
✅ User created: `user` with password `password`  
✅ Privileges granted  
❌ Authentication method incompatible with Prisma  

The application code has no issues - this is purely a database configuration problem.

## Recommended Path Forward
**Option 1 (MySQL 5.7)** is recommended for quickest resolution:
1. It's widely supported
2. Fully compatible with Prisma
3. Free Community Edition
4. No application code changes needed
5. Can be upgraded later when Prisma updates

## Testing After Fix
Once you switch to a compatible authentication method:

```bash
npm -w web run dev
```

Then test registration via browser at `http://localhost:3000/register`

Or via PowerShell:
```powershell
$body = @{
    email = "test@example.com"
    screenName = "testuser"
    password = "TestPassword123!"
    remember = $true
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/api/auth/register" `
  -Method POST `
  -ContentType "application/json" `
  -Headers @{ Origin = "http://localhost:3000" } `
  -Body $body
```

Should return status 200 with user ID and session cookie.
