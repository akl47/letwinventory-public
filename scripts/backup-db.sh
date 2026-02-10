#!/usr/bin/env bash
set -euo pipefail

# --- Configuration (override via environment or .env file) ---
: "${DB_HOST:=localhost}"
: "${DB_PORT:=5432}"
: "${DB_NAME:=letwinventory}"
: "${DB_USERNAME:=letwinventoy_user}"
: "${BACKUP_DIR:=/home/letwinco/backups}"
: "${RETENTION_DAYS:=30}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="${DB_NAME}_${TIMESTAMP}.dump"
BACKUP_PATH="${BACKUP_DIR}/${FILENAME}"

# --- Create backup directory ---
mkdir -p "$BACKUP_DIR"

# --- Dump database ---
echo "[$(date)] Starting backup: ${FILENAME}"
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" \
  -Fc --no-owner --no-acl -f "$BACKUP_PATH"
echo "[$(date)] Backup created: $(du -h "$BACKUP_PATH" | cut -f1)"

# # --- Clean up old local backups ---
# find "$BACKUP_DIR" -name "${DB_NAME}_*.dump" -mtime +${RETENTION_DAYS} -delete
# echo "[$(date)] Cleaned local backups older than ${RETENTION_DAYS} days"

echo "[$(date)] Backup complete: ${FILENAME}"
