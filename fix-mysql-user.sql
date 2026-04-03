-- Fix MySQL user authentication plugin for Prisma compatibility
-- This script changes the user's password hashing from sha256_password to mysql_native_password

-- Update the user (adjust host if needed - use 'localhost' if connecting locally, '%' for any host)
ALTER USER 'user'@'%' IDENTIFIED WITH mysql_native_password BY 'password';
FLUSH PRIVILEGES;

-- Verify the change
SELECT user, host, plugin FROM mysql.user WHERE user = 'user';
