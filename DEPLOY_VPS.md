# VPS Deployment

This repo already includes a containerized production path. The simplest VPS setup is:

1. Install Docker, Docker Compose plugin, Git, and Nginx.
2. Clone the repo into `/srv/yehthatrocks`.
3. Create `/srv/yehthatrocks/.env.production`.
4. Start the stack with `docker compose`.
5. Daemonize it with the included `systemd` unit.

The production stack uses [docker-compose.prod.yml](docker-compose.prod.yml) and the `systemd` unit template at [deploy/systemd/yehthatrocks.service](deploy/systemd/yehthatrocks.service).

## 1. Base Server Packages

Ubuntu/Debian example:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git nginx

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

Optional non-root Docker access:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

## 2. Clone The Repo

```bash
sudo mkdir -p /srv/yehthatrocks
sudo chown $USER:$USER /srv/yehthatrocks
git clone git@github.com:SimonJamesOdell/YehThatRocks.git /srv/yehthatrocks
cd /srv/yehthatrocks
```

If you prefer HTTPS:

```bash
git clone https://github.com/SimonJamesOdell/YehThatRocks.git /srv/yehthatrocks
```

## 3. Create The Production Env File

Create `/srv/yehthatrocks/.env.production` from [.env.production.example](.env.production.example):

```bash
cp .env.production.example .env.production
```

Then edit it:

```dotenv
MYSQL_ROOT_PASSWORD=replace-this
MYSQL_DATABASE=yeh
MYSQL_USER=yeh
MYSQL_PASSWORD=replace-this-too

APP_PORT=3000
APP_URL=https://yehthatrocks.com
AUTH_JWT_SECRET=replace-with-a-random-32-plus-character-secret

YOUTUBE_DATA_API_KEY=
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@yehthatrocks.com
```

Generate a strong JWT secret:

```bash
openssl rand -base64 48
```

## 4. First Start

From `/srv/yehthatrocks`:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Check status:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f web
```

Important notes:

- The app container currently runs `prisma db push` on startup.
- The bundled seed file is idempotent and is executed on startup.
- MySQL is not published publicly in the production compose file.
- The web container is bound to `127.0.0.1:3000`, so you should put Nginx in front of it.

## 5. Nginx Reverse Proxy

Basic site config:

```nginx
server {
    listen 80;
    server_name yehthatrocks.com www.yehthatrocks.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Enable it:

```bash
sudo tee /etc/nginx/sites-available/yehthatrocks > /dev/null <<'EOF'
server {
    listen 80;
    server_name yehthatrocks.com www.yehthatrocks.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/yehthatrocks /etc/nginx/sites-enabled/yehthatrocks
sudo nginx -t
sudo systemctl reload nginx
```

## 6. TLS With Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yehthatrocks.com -d www.yehthatrocks.com
```

After TLS is live, make sure `APP_URL` in `.env.production` is `https://...`, then restart the stack.

## 7. Daemonize With systemd

Copy the included unit file:

```bash
sudo cp deploy/systemd/yehthatrocks.service /etc/systemd/system/yehthatrocks.service
sudo systemctl daemon-reload
sudo systemctl enable --now yehthatrocks
```

Useful commands:

```bash
sudo systemctl status yehthatrocks
sudo systemctl restart yehthatrocks
sudo journalctl -u yehthatrocks -n 200 --no-pager
```

## 8. Deploy Workflow After Future git pull

Once the service is installed, your update flow is:

```bash
cd /srv/yehthatrocks
sudo ./deploy/deploy-prod-hot-swap.sh
```

This script performs a safer deploy sequence for a live site:

- Pull latest code with `--ff-only`
- Build the `web` image first
- Recreate only the `web` container (`db` stays running)
- Wait for `http://127.0.0.1:${APP_PORT}/api/status`
- Roll back to previous image automatically if health times out
- Prune Docker build cache and unused images after a successful deploy by default

Optional environment overrides:

```bash
REPO_DIR=/srv/yehthatrocks \
TARGET_BRANCH=main \
HEALTH_TIMEOUT_SEC=180 \
HEALTH_PATH=/api/status \
sudo -E ./deploy/deploy-prod-hot-swap.sh
```

Cleanup controls for small VPS disks:

```bash
CLEANUP_AFTER_DEPLOY=1 \
CLEANUP_BUILDER_CACHE=1 \
CLEANUP_UNUSED_IMAGES=1 \
sudo -E ./deploy/deploy-prod-hot-swap.sh
```

Default behavior on this repo is to clean builder cache and unused images after a successful deploy. This is intentional for low-disk VPS instances where repeated builds can quickly consume the root volume.

If you still want to use `systemctl`, prefer reload over restart:

```bash
sudo systemctl reload yehthatrocks
```

`restart` executes `ExecStop`, which can cause avoidable downtime.

If you want to watch startup logs immediately after a deploy:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f web
```

## 9. Firewall

If UFW is enabled:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

You do not need to open MySQL or port 3000 publicly with the production compose setup.

## 10. Sanity Checks

After deployment:

```bash
curl -I http://127.0.0.1:3000
curl -I https://yehthatrocks.com
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

If you want a lower-friction first deployment, use the bundled MySQL container exactly as shown above. If you later move MySQL to a managed database, the web service can be pointed at that external `DATABASE_URL` and the `db` service can be removed from the compose file.