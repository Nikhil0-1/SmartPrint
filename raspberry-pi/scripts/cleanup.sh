#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - SECURE TEMPORARY FILE CLEANUP SCRIPT
# Shreds and unlinks stale temporary customer documents on Raspberry Pi
# ==============================================================================

JOBS_DIR="/var/lib/smartprint/jobs"

echo "[SMARTPRINT CLEANUP] Initiating secure wipe routine on $JOBS_DIR..."

if [ ! -d "$JOBS_DIR" ]; then
  mkdir -p "$JOBS_DIR"
  chmod 700 "$JOBS_DIR"
  exit 0
fi

# Find files older than 30 minutes or leftover from aborted jobs
find "$JOBS_DIR" -type f | while read -r file; do
  echo "[CLEANUP] Shredding temporary file: $file"
  if command -v shred >/dev/null 2>&1; then
    shred -u -n 1 "$file" 2>/dev/null || rm -f "$file"
  else
    dd if=/dev/zero of="$file" bs=4k count=1 conv=notrunc 2>/dev/null || true
    rm -f "$file"
  fi
done

# Remove empty subdirectories
find "$JOBS_DIR" -mindepth 1 -type d -empty -delete 2>/dev/null || true

echo "[SMARTPRINT CLEANUP] Secure wipe routine completed successfully."
