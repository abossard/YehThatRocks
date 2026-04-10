#!/usr/bin/env bash
set -euo pipefail

# Near-zero-downtime deploy for single-host Docker Compose setups.
# - Pulls latest code
# - Pulls prebuilt web image before swap
# - Recreates web only (keeps db/network running)
# - Waits for health endpoint
# - Rolls back to previous web image if health check fails

REPO_DIR="${REPO_DIR:-/srv/yehthatrocks}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_DIR/docker-compose.prod.yml}"
TARGET_BRANCH="${TARGET_BRANCH:-main}"
HEALTH_PATH="${HEALTH_PATH:-/api/status}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-120}"
HEALTH_REQUEST_TIMEOUT_SEC="${HEALTH_REQUEST_TIMEOUT_SEC:-5}"
LOCK_FILE="${LOCK_FILE:-/tmp/yehthatrocks-deploy.lock}"
CLEANUP_AFTER_DEPLOY="${CLEANUP_AFTER_DEPLOY:-1}"
CLEANUP_BUILDER_CACHE="${CLEANUP_BUILDER_CACHE:-1}"
CLEANUP_UNUSED_IMAGES="${CLEANUP_UNUSED_IMAGES:-1}"
SKIP_PULL="${SKIP_PULL:-0}"
WEB_IMAGE_DEFAULT="ghcr.io/simonjamesodell/yehthatrocks-web:latest"

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

WEB_IMAGE_FROM_ENV_FILE="$(grep -E '^WEB_IMAGE=' "$ENV_FILE" | tail -n 1 | cut -d'=' -f2- || true)"
WEB_IMAGE_FROM_ENV_FILE="${WEB_IMAGE_FROM_ENV_FILE//\"/}"
WEB_IMAGE_FROM_ENV_FILE="${WEB_IMAGE_FROM_ENV_FILE//\'/}"
WEB_IMAGE="${WEB_IMAGE:-${WEB_IMAGE_FROM_ENV_FILE:-$WEB_IMAGE_DEFAULT}}"

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

wait_for_public_health() {
  local status_url="$1"
  local timeout_sec="$2"
  local start_ts now_ts elapsed

  start_ts="$(date +%s)"
  while true; do
    if curl -fsS --max-time "$HEALTH_REQUEST_TIMEOUT_SEC" "$status_url" >/dev/null 2>&1; then
      return 0
    fi

    now_ts="$(date +%s)"
    elapsed="$((now_ts - start_ts))"
    if [ "$elapsed" -ge "$timeout_sec" ]; then
      return 1
    fi

    sleep 2
  done
}

wait_for_canary_health() {
  local container_name="$1"
  local timeout_sec="$2"
  local start_ts now_ts elapsed

  start_ts="$(date +%s)"
  while true; do
    if ! docker ps --format '{{.Names}}' | grep -Fxq "$container_name"; then
      echo "[deploy] canary container is not running: $container_name" >&2
      docker logs --tail=120 "$container_name" >&2 || true
      return 1
    fi

    if docker exec "$container_name" node -e "const timeout = AbortSignal.timeout(${HEALTH_REQUEST_TIMEOUT_SEC}000); fetch('http://127.0.0.1:3000${HEALTH_PATH}', { signal: timeout }).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1));" >/dev/null 2>&1; then
      return 0
    fi

    now_ts="$(date +%s)"
    elapsed="$((now_ts - start_ts))"
    if [ "$elapsed" -ge "$timeout_sec" ]; then
      echo "[deploy] canary health check timed out after ${timeout_sec}s" >&2
      docker logs --tail=120 "$container_name" >&2 || true
      return 1
    fi

    sleep 2
  done
}

echo "[deploy] fetching latest refs"
git fetch origin "$TARGET_BRANCH"

echo "[deploy] switching to $TARGET_BRANCH"
git checkout "$TARGET_BRANCH"

echo "[deploy] pulling latest commit"
git pull --ff-only origin "$TARGET_BRANCH"

CURRENT_COMMIT="$(git rev-parse --short HEAD)"
echo "[deploy] target commit: $CURRENT_COMMIT"

PREV_CONTAINER_ID="$("${COMPOSE[@]}" ps -q web 2>/dev/null || true)"
PREV_IMAGE_ID=""
if [ -n "$PREV_CONTAINER_ID" ]; then
  PREV_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$PREV_CONTAINER_ID" 2>/dev/null || true)"
fi

if [ -n "$PREV_IMAGE_ID" ]; then
  echo "[deploy] snapshotting current web image for rollback"
  docker tag "$PREV_IMAGE_ID" yehthatrocks-web:rollback
fi

if [ "$SKIP_PULL" = "1" ]; then
  echo "[deploy] skipping image pull (SKIP_PULL=1), expecting image to already exist locally: $WEB_IMAGE"
else
  echo "[deploy] pulling web image: $WEB_IMAGE"
  WEB_IMAGE="$WEB_IMAGE" "${COMPOSE[@]}" pull web
fi

STATUS_URL="http://127.0.0.1:${APP_PORT}${HEALTH_PATH}"
echo "[deploy] preflighting candidate image before swap"
CANARY_NAME="yehthatrocks-web-canary-${CURRENT_COMMIT}-$$"
cleanup_canary() {
  docker rm -f "$CANARY_NAME" >/dev/null 2>&1 || true
}
trap cleanup_canary EXIT

WEB_IMAGE="$WEB_IMAGE" "${COMPOSE[@]}" run -d --no-deps --name "$CANARY_NAME" web >/dev/null

if ! wait_for_canary_health "$CANARY_NAME" "$HEALTH_TIMEOUT_SEC"; then
  echo "[deploy] candidate image failed canary preflight; keeping current web container live" >&2
  cleanup_docker_artifacts
  exit 1
fi

echo "[deploy] canary passed; swapping web container"
WEB_IMAGE="$WEB_IMAGE" "${COMPOSE[@]}" up -d --no-deps web

echo "[deploy] verifying live health after swap: $STATUS_URL"
if wait_for_public_health "$STATUS_URL" "$HEALTH_TIMEOUT_SEC"; then
  echo "[deploy] health check passed"
  cleanup_docker_artifacts
  echo "[deploy] deploy complete: $CURRENT_COMMIT"
  exit 0
fi

echo "[deploy] post-swap health check timed out after ${HEALTH_TIMEOUT_SEC}s" >&2
if docker image inspect yehthatrocks-web:rollback >/dev/null 2>&1; then
  echo "[deploy] rolling back to previous image"
  WEB_IMAGE="yehthatrocks-web:rollback" "${COMPOSE[@]}" up -d --no-deps web

  if wait_for_public_health "$STATUS_URL" "$HEALTH_TIMEOUT_SEC"; then
    echo "[deploy] rollback succeeded" >&2
  else
    echo "[deploy] rollback attempted, but health endpoint is still failing" >&2
  fi
else
  echo "[deploy] rollback image not available" >&2
fi

# Cleanup should also run on failure to avoid accumulating unused images.
cleanup_docker_artifacts
exit 1
