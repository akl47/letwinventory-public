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

trap 'send_email "[FAILED] DB Backup - $(date +%Y-%m-%d %H:%M)"' ERR

# --- Load .env.production ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env.production"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
else
  log "[$(date)] ERROR: ${ENV_FILE} not found"
  exit 1
fi

# pg_dump runs on the host, not in Docker — use localhost
DB_HOST=localhost
: "${BACKUP_DIR:=/home/letwinco/backups}"
: "${RETENTION_DAYS:=30}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="${DB_NAME}_${TIMESTAMP}.dump"
BACKUP_PATH="${BACKUP_DIR}/${FILENAME}"

# --- Create backup directory ---
mkdir -p "$BACKUP_DIR"

# --- Check disk space ---
DISK_USAGE=$(df "$BACKUP_DIR" | awk 'NR==2 {gsub(/%/,""); print $5}')
if [ "$DISK_USAGE" -ge 90 ]; then
  log "[$(date)] ERROR: Disk usage at ${DISK_USAGE}%, skipping backup"
  exit 1
fi

# --- Dump database ---
export PGPASSWORD="$DB_PASSWORD"
log "[$(date)] Starting backup: ${FILENAME}"
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" \
  -Fc --no-owner --no-acl -f "$BACKUP_PATH"
log "[$(date)] Backup created: $(du -h "$BACKUP_PATH" | cut -f1)"

# # --- Clean up old local backups ---
# find "$BACKUP_DIR" -name "${DB_NAME}_*.dump" -mtime +${RETENTION_DAYS} -delete
# log "[$(date)] Cleaned local backups older than ${RETENTION_DAYS} days"

DISK_FREE=$(df -h "$BACKUP_DIR" | awk 'NR==2 {print $4}')
log "[$(date)] Disk: ${DISK_USAGE}% used, ${DISK_FREE} free"
log "[$(date)] Backup complete: ${FILENAME}"
send_email "[OK] DB Backup - ${FILENAME}"
