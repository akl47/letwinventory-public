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

trap 'send_email "[FAILED] Backup Pull - $(date +%Y-%m-%d %H:%M)"' ERR

# --- Load .env.readynas if present ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.readynas"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# --- Configuration (defaults if not in .env) ---
# : "${VPS_HOST:=185.148.129.180}"
# : "${VPS_USER:=letwinco}"
# : "${VPS_PORT:=7822}"
# : "${VPS_BACKUP_DIR:=/home/letwinco/backups}"
# : "${LOCAL_BACKUP_DIR:=/data/letwinventory-backups}"

# # --- Create local backup directory ---
# mkdir -p "$LOCAL_BACKUP_DIR"

# # --- Find latest backup on VPS ---
log "[$(date)] Finding latest backup on ${VPS_HOST}..."
LATEST=$(ssh -p "$VPS_PORT" "${VPS_USER}@${VPS_HOST}" "ls -t ${VPS_BACKUP_DIR}/*.dump 2>/dev/null | head -1")

if [ -z "$LATEST" ]; then
  log "[$(date)] ERROR: No backups found on VPS"
  send_email "[FAILED] Backup Pull - No backups on VPS"
  exit 1
fi
log "[$(date)] Latest backup found: ${LATEST}"
FILENAME=$(basename "$LATEST")

# # --- Skip if already downloaded ---
if [ -f "${LOCAL_BACKUP_DIR}/${FILENAME}" ]; then
  log "[$(date)] Already have ${FILENAME}, skipping"
  send_email "[SKIP] Backup Pull - ${FILENAME}"
  exit 0
fi

# # --- Download ---
log "[$(date)] Downloading ${FILENAME}..."
scp -P "$VPS_PORT" "${VPS_USER}@${VPS_HOST}:${LATEST}" "${LOCAL_BACKUP_DIR}/${FILENAME}"
log "[$(date)] Downloaded: $(du -h "${LOCAL_BACKUP_DIR}/${FILENAME}" | cut -f1)"

# # --- Delete from VPS after successful download ---
ssh -p "$VPS_PORT" "${VPS_USER}@${VPS_HOST}" "rm -f ${LATEST}"
log "[$(date)] Deleted ${FILENAME} from VPS"

log "[$(date)] Pull complete: ${FILENAME}"
send_email "[OK] Backup Pull - ${FILENAME}"
