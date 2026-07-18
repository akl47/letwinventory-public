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

trap 'send_email "[FAILED] Deploy Update - $(date +%Y-%m-%d_%H:%M)"' ERR

CONTAINER_NAME="letwinventory-backend-prod"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.prod.yml"

# --- Lock file ---
LOCK_FILE="/tmp/letwinventory-update.lock"
if [ -f "$LOCK_FILE" ]; then
  log "[$(date)] Another update is already running (lock file exists), exiting"
  exit 1
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"; send_email "[FAILED] Deploy Update - $(date +%Y-%m-%d_%H:%M)"' ERR
trap 'rm -f "$LOCK_FILE"' EXIT

# --- Backup database ---
log "[$(date)] Running database backup..."
"${SCRIPT_DIR}/backup-db.sh" || {
  log "[$(date)] ERROR: Backup failed, aborting deploy"
  exit 1
}
log "[$(date)] Backup complete"

# --- Pull new images ---
log "[$(date)] Pulling latest app image..."
docker pull akl47/letwinventory:latest
log "[$(date)] Pulling latest CAD kernel image..."
docker pull ghcr.io/akl47/letwinventory-cad-kernel:latest
log "[$(date)] Pulls complete"

# --- Restart containers ---
# --force-recreate swaps BOTH services onto the freshly pulled images — a
# `docker pull` alone never restarts a running container (recurring footgun).
log "[$(date)] Restarting containers..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate
log "[$(date)] Containers restarted"

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
log "[$(date)] Waiting for backend to accept connections..."
for i in $(seq 1 6); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" || true)
  if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "200" ]; then
    log "[$(date)] Health check passed (HTTP ${HTTP_CODE})"
    break
  fi
  if [ "$i" -eq 6 ]; then
    log "[$(date)] WARNING: Health check returned HTTP ${HTTP_CODE} after 30s (expected 401)"
    break
  fi
  sleep 5
done

# --- CAD kernel handshake (REQ 900) ---
# The kernel must be reachable from the backend AND agree on the naming schema
# version, or every CAD regenerate will fail (mismatch = cache-poison guard).
log "[$(date)] Verifying CAD kernel handshake..."
KERNEL_CHECK=$(docker exec "$CONTAINER_NAME" node -e '
const net = require("net");
const NAMING = require("/usr/src/services/cadRegenService").NAMING_VERSION;
const addr = (process.env.CAD_KERNEL_ADDR || "letwinventory-cad-kernel:9876").split(":");
const s = net.connect(Number(addr[1] || 9876), addr[0], () =>
  s.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} }) + "\n"));
s.on("data", (d) => {
  const r = JSON.parse(d.toString()).result || {};
  if (r.namingSchemaVersion === NAMING) { console.log(`OK build=${r.build} naming=${r.namingSchemaVersion}`); process.exit(0); }
  console.log(`MISMATCH kernel=${r.namingSchemaVersion} backend=${NAMING} build=${r.build}`); process.exit(1);
});
s.on("error", (e) => { console.log(`UNREACHABLE ${e.message}`); process.exit(1); });
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 5000);
' 2>&1) || {
  log "[$(date)] ERROR: CAD kernel handshake failed: ${KERNEL_CHECK}"
  exit 1
}
log "[$(date)] CAD kernel handshake: ${KERNEL_CHECK}"

IMAGE_ID=$(docker inspect --format='{{.Image}}' "$CONTAINER_NAME" 2>/dev/null | cut -c8-19)
KERNEL_IMAGE_ID=$(docker inspect --format='{{.Image}}' letwinventory-cad-kernel-prod 2>/dev/null | cut -c8-19)
log "[$(date)] Deploy complete. App image: ${IMAGE_ID}, kernel image: ${KERNEL_IMAGE_ID}"
send_email "[OK] Deploy Update - $(date '+%Y-%m-%d %H:%M')"
