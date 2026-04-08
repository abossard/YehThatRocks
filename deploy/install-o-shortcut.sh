#!/usr/bin/env bash
set -euo pipefail

# Installs a host-level shortcut command named "o" that opens MySQL in the
# running Docker db service using credentials from the container environment.

REPO_DIR="${REPO_DIR:-/srv/yehthatrocks}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_DIR/docker-compose.prod.yml}"
TARGET_BIN="${TARGET_BIN:-/usr/local/bin/o}"

if ! command -v docker >/dev/null 2>&1; then
  echo "[install-o] docker not found" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "[install-o] env file not found at $ENV_FILE" >&2
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[install-o] compose file not found at $COMPOSE_FILE" >&2
  exit 1
fi

if [ ! -d "$REPO_DIR" ]; then
  echo "[install-o] repo dir not found at $REPO_DIR" >&2
  exit 1
fi

install -d "$(dirname "$TARGET_BIN")"

cat > "$TARGET_BIN" <<EOF
#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="${REPO_DIR}"
ENV_FILE="${ENV_FILE}"
COMPOSE_FILE="${COMPOSE_FILE}"

cd "\$REPO_DIR"

# Use DB container environment so no host-side credential prompts are needed.
exec docker compose --env-file "\$ENV_FILE" -f "\$COMPOSE_FILE" exec db sh -lc 'MYSQL_PWD="\$MYSQL_ROOT_PASSWORD" exec mysql -uroot "\$MYSQL_DATABASE"'
EOF

chmod 0755 "$TARGET_BIN"

echo "[install-o] installed shortcut at $TARGET_BIN"
echo "[install-o] run: o"
