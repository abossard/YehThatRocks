#!/usr/bin/env bash
set -euo pipefail

WINDOWS_USER="${1:-}"
WINDOWS_HOST="${2:-}"
REMOTE_PORT="${3:-3000}"
LOCAL_PORT="${4:-3000}"

if [[ -z "$WINDOWS_USER" || -z "$WINDOWS_HOST" ]]; then
  echo "Usage: $0 <windows-user> <windows-host-or-ip> [remote-port=3000] [local-port=3000]"
  exit 1
fi

echo "Opening tunnel: localhost:${LOCAL_PORT} (Linux) -> 127.0.0.1:${REMOTE_PORT} (Windows)"
echo "Press Ctrl+C to stop."

SSH_OPTS=(
  -N
  -L "${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}"
  -o ExitOnForwardFailure=yes
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=3
  -o StrictHostKeyChecking=accept-new
)

while true; do
  if ssh "${SSH_OPTS[@]}" "${WINDOWS_USER}@${WINDOWS_HOST}"; then
    break
  fi

  echo "Tunnel disconnected; retrying in 2 seconds..."
  sleep 2
done
