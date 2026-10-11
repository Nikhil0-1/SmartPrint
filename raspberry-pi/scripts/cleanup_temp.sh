#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - LOCAL TEMPORARY SPOOL ZERO-RETENTION CLEANUP
# Overwrites local temporary spool files with zeroes before unlinking.
# ==============================================================================

set -euo pipefail

SPOOL_DIR="/var/lib/smartprint/jobs"
RETENTION_MINS=15

echo "=========================================================="
echo "  GITAM SMARTPRINT — ZERO-RETENTION LOCAL SPOOL PURGE"
echo "=========================================================="

if [ ! -d "$SPOOL_DIR" ]; then
    echo "[INFO] Spool directory $SPOOL_DIR does not exist. Nothing to purge."
    exit 0
fi

# Find files older than retention limit
FOUND_FILES=$(find "$SPOOL_DIR" -type f -mmin "+${RETENTION_MINS}" 2>/dev/null || true)

if [ -z "$FOUND_FILES" ]; then
    echo "[INFO] No stale spool files older than ${RETENTION_MINS} minutes."
    exit 0
fi

COUNT=0
for f in $FOUND_FILES; do
    echo "[INFO] Zeroizing and shredding: $f"
    # Overwrite with zeroes if shred is available, otherwise dd
    if command -v shred >/dev/null 2>&1; then
        shred -u -z -n 1 "$f"
    else
        dd if=/dev/zero of="$f" bs=1024 count=100 conv=notrunc status=none || true
        rm -f "$f"
    fi
    COUNT=$((COUNT + 1))
done

echo "[OK] Permanently purged and zeroized $COUNT expired local spool files."
