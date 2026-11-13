#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - PRIVACY CLEANUP & BOUNDED RETENTION SCRIPT
# Cleans expired temporary files while strictly preserving active recovery jobs.
# ==============================================================================

set -o pipefail

STATE_DIR="${SMARTPRINT_STATE_DIR:-"/var/lib/smartprint"}"
JOBS_DIR="${STATE_DIR}/jobs"
RECOVERY_DIR="${STATE_DIR}/recovery"

echo "[SMARTPRINT CLEANUP] Initiating bounded retention cleanup on $STATE_DIR..."

# 1. Clean stale temporary workspaces (> 60 minutes old) from aborted jobs
if [ -d "$JOBS_DIR" ]; then
  find "$JOBS_DIR" -mindepth 1 -maxdepth 2 -type f -mmin +60 | while read -r file; do
    echo "[CLEANUP] Securely wiping stale workspace file: $file"
    if command -v shred >/dev/null 2>&1; then
      shred -u -n 1 "$file" 2>/dev/null || rm -f "$file"
    else
      dd if=/dev/zero of="$file" bs=4k count=1 conv=notrunc 2>/dev/null || true
      rm -f "$file"
    fi
  done
  find "$JOBS_DIR" -mindepth 1 -type d -empty -delete 2>/dev/null || true
fi

# 2. Clean expired recovery files (> 24 hours old) per emergency retention policy
# Unexpired recovery files are PRESERVED for operator inspection.
if [ -d "$RECOVERY_DIR" ]; then
  find "$RECOVERY_DIR" -mindepth 1 -maxdepth 2 -type f -mmin +1440 | while read -r file; do
    echo "[CLEANUP] Purging expired (>24h) recovery file: $file"
    if command -v shred >/dev/null 2>&1; then
      shred -u -n 1 "$file" 2>/dev/null || rm -f "$file"
    else
      dd if=/dev/zero of="$file" bs=4k count=1 conv=notrunc 2>/dev/null || true
      rm -f "$file"
    fi
  done
  find "$RECOVERY_DIR" -mindepth 1 -type d -empty -delete 2>/dev/null || true
fi

echo "[SMARTPRINT CLEANUP] Bounded retention routine completed successfully."
