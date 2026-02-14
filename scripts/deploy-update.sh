#!/usr/bin/env bash
set -euo pipefail

LOG=""

log() { LOG+="$1"$'\n'; echo "$1"; }

send_email() {
  local subject="$1"
  curl -s --url "smtps://smtp.gmail.com:465" \
    --ssl-reqd \
    --mail-from "$SMTP_EMAIL" \
    --mail-rcpt "$NOTIFY_EMAIL" \
    --user "${SMTP_EMAIL}:${SMTP_PASSWORD}" \
    -T - <<MAIL
From: ${SMTP_EMAIL}
To: ${NOTIFY_EMAIL}
Subject: ${subject}

${LOG}
MAIL
}

# --- Load .env.production ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${SCRIPT_DIR}/.."
ENV_FILE="${PROJECT_DIR}/.env.production"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
else
  echo "[$(date)] ERROR: ${ENV_FILE} not found"
  exit 1
fi

trap 'send_email "[FAILED] Deploy Update - $(date +%Y-%m-%d\ %H:%M)"' ERR

CONTAINER_NAME="letwinventory-backend-prod"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.prod.yml"

# --- Lock file ---
LOCK_FILE="/tmp/letwinventory-update.lock"
if [ -f "$LOCK_FILE" ]; then
  log "[$(date)] Another update is already running (lock file exists), exiting"
  exit 1
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"; send_email "[FAILED] Deploy Update - $(date +%Y-%m-%d\ %H:%M)"' ERR
trap 'rm -f "$LOCK_FILE"' EXIT

# --- Backup database ---
log "[$(date)] Running database backup..."
"${SCRIPT_DIR}/backup-db.sh" || {
  log "[$(date)] ERROR: Backup failed, aborting deploy"
  exit 1
}
log "[$(date)] Backup complete"

# --- Pull new image ---
log "[$(date)] Pulling latest image..."
docker pull akl47/letwinventory:latest
log "[$(date)] Pull complete"

# --- Restart container ---
log "[$(date)] Restarting container..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate
log "[$(date)] Container restarted"

# --- Wait for container to be ready ---
log "[$(date)] Waiting for container to start..."
for i in $(seq 1 12); do
  if docker exec "$CONTAINER_NAME" true 2>/dev/null; then
    log "[$(date)] Container is running"
    break
  fi
  if [ "$i" -eq 12 ]; then
    log "[$(date)] ERROR: Container not ready after 60s"
    exit 1
  fi
  sleep 5
done

# --- Run migrations ---
log "[$(date)] Running database migrations..."
docker exec "$CONTAINER_NAME" npx sequelize-cli db:migrate --env production
log "[$(date)] Migrations complete"

# --- Health check ---
HEALTH_URL="http://localhost:${BACKEND_PORT:-3000}/api/auth/user/check-token"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" || true)
if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "200" ]; then
  log "[$(date)] Health check passed (HTTP ${HTTP_CODE})"
else
  log "[$(date)] WARNING: Health check returned HTTP ${HTTP_CODE} (expected 401)"
fi

IMAGE_ID=$(docker inspect --format='{{.Image}}' "$CONTAINER_NAME" 2>/dev/null | cut -c8-19)
log "[$(date)] Deploy complete. Image: ${IMAGE_ID}"
send_email "[OK] Deploy Update - $(date +%Y-%m-%d %H:%M)"
