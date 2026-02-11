#!/usr/bin/env bash
set -euo pipefail

# --- Load .env.readynas if present ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env.readynas"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# --- Configuration (defaults if not in .env) ---
: "${VPS_HOST:=185.148.129.180}"
: "${VPS_USER:=letwinventory}"
: "${VPS_BACKUP_DIR:=/home/letwinco/backups}"
: "${LOCAL_BACKUP_DIR:=/data/letwinventory-backups}"
: "${RETENTION_DAYS:=30}"

# --- Create local backup directory ---
mkdir -p "$LOCAL_BACKUP_DIR"

# --- Find latest backup on VPS ---
echo "[$(date)] Finding latest backup on ${VPS_HOST}..."
LATEST=$(ssh "${VPS_USER}@${VPS_HOST}" "ls -t ${VPS_BACKUP_DIR}/*.dump 2>/dev/null | head -1")

if [ -z "$LATEST" ]; then
  echo "[$(date)] ERROR: No backups found on VPS"
  exit 1
fi

FILENAME=$(basename "$LATEST")

# --- Skip if already downloaded ---
if [ -f "${LOCAL_BACKUP_DIR}/${FILENAME}" ]; then
  echo "[$(date)] Already have ${FILENAME}, skipping"
  exit 0
fi

# --- Download ---
echo "[$(date)] Downloading ${FILENAME}..."
scp "${VPS_USER}@${VPS_HOST}:${LATEST}" "${LOCAL_BACKUP_DIR}/${FILENAME}"
echo "[$(date)] Downloaded: $(du -h "${LOCAL_BACKUP_DIR}/${FILENAME}" | cut -f1)"

# --- Delete from VPS after successful download ---
ssh "${VPS_USER}@${VPS_HOST}" "rm -f ${LATEST}"
echo "[$(date)] Deleted ${FILENAME} from VPS"

echo "[$(date)] Pull complete: ${FILENAME}"
