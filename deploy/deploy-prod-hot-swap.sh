#!/usr/bin/env bash
set -euo pipefail

# Near-zero-downtime deploy for single-host Docker Compose setups.
# - Pulls latest code
# - Builds web image before swap
# - Recreates web only (keeps db/network running)
# - Waits for health endpoint
# - Rolls back to previous web image if health check fails

REPO_DIR="${REPO_DIR:-/srv/yehthatrocks}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_DIR/docker-compose.prod.yml}"
TARGET_BRANCH="${TARGET_BRANCH:-main}"
HEALTH_PATH="${HEALTH_PATH:-/api/status}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-120}"
LOCK_FILE="${LOCK_FILE:-/tmp/yehthatrocks-deploy.lock}"
CLEANUP_AFTER_DEPLOY="${CLEANUP_AFTER_DEPLOY:-1}"
CLEANUP_BUILDER_CACHE="${CLEANUP_BUILDER_CACHE:-1}"
CLEANUP_UNUSED_IMAGES="${CLEANUP_UNUSED_IMAGES:-1}"

if ! command -v docker >/dev/null 2>&1; then
  echo "[deploy] docker not found" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "[deploy] git not found" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[deploy] curl not found" >&2
  exit 1
fi

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[deploy] repo not found at $REPO_DIR" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "[deploy] env file not found at $ENV_FILE" >&2
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[deploy] compose file not found at $COMPOSE_FILE" >&2
  exit 1
fi

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[deploy] another deploy is already running" >&2
  exit 1
fi

cd "$REPO_DIR"

APP_PORT="$(grep -E '^APP_PORT=' "$ENV_FILE" | tail -n 1 | cut -d'=' -f2- || true)"
APP_PORT="${APP_PORT:-3000}"
APP_PORT="${APP_PORT//\"/}"
APP_PORT="${APP_PORT//\'/}"

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

cleanup_docker_artifacts() {
  if [ "$CLEANUP_AFTER_DEPLOY" != "1" ]; then
    echo "[deploy] cleanup disabled"
    return 0
  fi

  echo "[deploy] cleaning Docker artifacts"

  if [ "$CLEANUP_BUILDER_CACHE" = "1" ]; then
    docker builder prune -af >/dev/null 2>&1 || echo "[deploy] builder cache cleanup skipped"
  fi

  if [ "$CLEANUP_UNUSED_IMAGES" = "1" ]; then
    docker image prune -af >/dev/null 2>&1 || echo "[deploy] image cleanup skipped"
  fi
}

echo "[deploy] fetching latest refs"
git fetch origin "$TARGET_BRANCH"

echo "[deploy] switching to $TARGET_BRANCH"
git checkout "$TARGET_BRANCH"

echo "[deploy] pulling latest commit"
git pull --ff-only origin "$TARGET_BRANCH"

CURRENT_COMMIT="$(git rev-parse --short HEAD)"
echo "[deploy] target commit: $CURRENT_COMMIT"

PREV_IMAGE_ID="$(docker image inspect yehthatrocks-web:latest --format '{{.Id}}' 2>/dev/null || true)"
if [ -n "$PREV_IMAGE_ID" ]; then
  echo "[deploy] snapshotting current image for rollback"
  docker tag yehthatrocks-web:latest yehthatrocks-web:rollback
fi

echo "[deploy] building web image"
"${COMPOSE[@]}" build web

echo "[deploy] swapping web container only"
"${COMPOSE[@]}" up -d --no-deps web

STATUS_URL="http://127.0.0.1:${APP_PORT}${HEALTH_PATH}"
echo "[deploy] waiting for health: $STATUS_URL"

START_TS="$(date +%s)"
while true; do
  if curl -fsS "$STATUS_URL" >/dev/null 2>&1; then
    echo "[deploy] health check passed"
    cleanup_docker_artifacts
    echo "[deploy] deploy complete: $CURRENT_COMMIT"
    exit 0
  fi

  NOW_TS="$(date +%s)"
  ELAPSED="$((NOW_TS - START_TS))"
  if [ "$ELAPSED" -ge "$HEALTH_TIMEOUT_SEC" ]; then
    echo "[deploy] health check timed out after ${HEALTH_TIMEOUT_SEC}s" >&2

    if docker image inspect yehthatrocks-web:rollback >/dev/null 2>&1; then
      echo "[deploy] rolling back to previous image"
      docker tag yehthatrocks-web:rollback yehthatrocks-web:latest
      "${COMPOSE[@]}" up -d --no-deps web

      if curl -fsS "$STATUS_URL" >/dev/null 2>&1; then
        echo "[deploy] rollback succeeded" >&2
      else
        echo "[deploy] rollback attempted, but health endpoint is still failing" >&2
      fi
    else
      echo "[deploy] rollback image not available" >&2
    fi

    exit 1
  fi

  sleep 2
done
