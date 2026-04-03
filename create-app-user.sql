CREATE USER IF NOT EXISTS 'user'@'localhost' IDENTIFIED BY 'password';
GRANT ALL PRIVILEGES ON yeh.* TO 'user'@'localhost';
GRANT ALL PRIVILEGES ON yeh.* TO 'user'@'%';
CREATE USER IF NOT EXISTS 'user'@'%' IDENTIFIED BY 'password';
FLUSH PRIVILEGES;
SELECT user, host, plugin FROM mysql.user WHERE user = 'user';
