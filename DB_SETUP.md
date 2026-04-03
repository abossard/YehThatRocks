# Database Setup & MySQL Authentication Fix

## Problem
Registration fails with: `Unknown authentication plugin 'sha256_password'`

Prisma's MySQL connector doesn't support the SHA-256 password plugin. You need to change your MySQL user to use the native password plugin.

## Solution

### Step 1: Connect to MySQL as Administrator
```bash
mysql -h localhost -u root -p
```

### Step 2: Alter the User Authentication Plugin
Replace `user`, `host`, and `password` with your actual values:

```sql
ALTER USER 'user'@'%' IDENTIFIED WITH mysql_native_password BY 'password';
FLUSH PRIVILEGES;
```

**Examples:**
- If using `localhost` instead of `%`:
  ```sql
  ALTER USER 'user'@'localhost' IDENTIFIED WITH mysql_native_password BY 'password';
  FLUSH PRIVILEGES;
  ```

- If your user is `root`:
  ```sql
  ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'your_password';
  FLUSH PRIVILEGES;
  ```

### Step 3: Verify the Change
```sql
SELECT user, host, plugin FROM mysql.user WHERE user = 'user';
```
You should see `mysql_native_password` in the plugin column.

### Step 4: Verify DATABASE_URL is Correct
Check your `apps/web/.env.local`:
```
DATABASE_URL=mysql://user:password@localhost:3306/yeh
```
- Replace `user` with actual MySQL username
- Replace `password` with actual MySQL password
- Replace `localhost` with your MySQL host if different
- Replace `3306` if using a different port
- Replace `yeh` with your actual database name

### Step 5: Restart the Dev Server
```bash
npm -w web run dev
```

### Step 6: Test Registration
Try registering again. The request should now reach the database successfully.

## Troubleshooting

**Still getting authentication errors?**
- Double-check the username and password in DATABASE_URL match exactly
- Verify the MySQL user account exists: `SELECT user FROM mysql.user;`
- Ensure the user has privileges on the `yeh` database

**Getting connection refused?**
- Check MySQL is running: `mysql -h localhost -u root -p -e "SELECT 1;"`
- Verify the host and port in DATABASE_URL are correct
- If MySQL is on a different machine, use its IP address instead of `localhost`

**Getting access denied?**
- Verify the password hasn't changed
- Try connecting manually first: `mysql -h localhost -u user -p`
- Run `GRANT ALL PRIVILEGES ON yeh.* TO 'user'@'%'; FLUSH PRIVILEGES;` if needed

