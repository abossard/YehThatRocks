#!/usr/bin/env bash
set -euo pipefail

# Installs a host-level shortcut command named "deploy" that runs the
# repository hot-swap script. Optional first arg can override WEB_IMAGE.

REPO_DIR="${REPO_DIR:-/srv/yehthatrocks}"
TARGET_BIN="${TARGET_BIN:-/usr/local/bin/deploy}"

if [ ! -d "$REPO_DIR" ]; then
  echo "[install-deploy] repo dir not found at $REPO_DIR" >&2
  exit 1
fi

install -d "$(dirname "$TARGET_BIN")"

cat > "$TARGET_BIN" <<EOF
#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="$REPO_DIR"

cd "\$REPO_DIR"

if [ "\${1:-}" != "" ]; then
  WEB_IMAGE="\$1" ./deploy/deploy-prod-hot-swap.sh
else
  ./deploy/deploy-prod-hot-swap.sh
fi
EOF

chmod 0755 "$TARGET_BIN"

echo "[install-deploy] installed shortcut at $TARGET_BIN"
echo "[install-deploy] run: deploy"
echo "[install-deploy] run with explicit image: deploy ghcr.io/simonjamesodell/yehthatrocks-web:<tag>"
