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

trap 'send_email "[FAILED] Backup Pull - $(date "+%Y-%m-%d %H:%M")"' ERR

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

# # --- Find all backups on VPS ---
log "[$(date)] Finding backups on ${VPS_HOST}..."
ALL_FILES=$(ssh -p "$VPS_PORT" "${VPS_USER}@${VPS_HOST}" "ls -t ${VPS_BACKUP_DIR}/*.dump 2>/dev/null")

if [ -z "$ALL_FILES" ]; then
  log "[$(date)] No backups found on VPS"
  send_email "[SKIP] Backup Pull - No backups on VPS"
  exit 0
fi

PULLED=0
SKIPPED=0
TO_DELETE=""

while IFS= read -r REMOTE_PATH; do
  FILENAME=$(basename "$REMOTE_PATH")

  if [ -f "${LOCAL_BACKUP_DIR}/${FILENAME}" ]; then
    log "[$(date)] Already have ${FILENAME}, skipping"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  log "[$(date)] Downloading ${FILENAME}..."
  if scp -P "$VPS_PORT" "${VPS_USER}@${VPS_HOST}:${REMOTE_PATH}" "${LOCAL_BACKUP_DIR}/${FILENAME}"; then
    log "[$(date)] Downloaded: $(du -h "${LOCAL_BACKUP_DIR}/${FILENAME}" | cut -f1)"
    TO_DELETE+=" ${REMOTE_PATH}"
    PULLED=$((PULLED + 1))
  else
    log "[$(date)] FAILED to download ${FILENAME}, keeping on VPS"
  fi
done <<< "$ALL_FILES"

# # --- Delete successfully pulled files from VPS ---
if [ -n "$TO_DELETE" ]; then
  ssh -p "$VPS_PORT" "${VPS_USER}@${VPS_HOST}" "rm -f ${TO_DELETE}"
  log "[$(date)] Deleted ${PULLED} file(s) from VPS"
fi

log "[$(date)] Pull complete: ${PULLED} downloaded, ${SKIPPED} skipped"
send_email "[OK] Backup Pull - ${PULLED} downloaded, ${SKIPPED} skipped"
