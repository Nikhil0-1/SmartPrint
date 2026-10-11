#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - CONTROLLED AGENT ROLLBACK SCRIPT
# Restores previous backup of agent code if an update causes issues.
# ==============================================================================

set -euo pipefail

TARGET_DIR="/opt/smartprint/agent"
BACKUP_DIR="/opt/smartprint/agent_backup"

echo "=========================================================="
echo "  GITAM SMARTPRINT — AGENT ROLLBACK"
echo "=========================================================="

if [ "$EUID" -ne 0 ]; then
    echo "[ERROR] This script must be run as root (sudo)."
    exit 1
fi

if [ ! -d "$BACKUP_DIR" ]; then
    echo "[ERROR] No rollback backup found at $BACKUP_DIR."
    exit 1
fi

echo "[INFO] Restoring agent files from $BACKUP_DIR..."
rm -rf "$TARGET_DIR"
cp -r "$BACKUP_DIR" "$TARGET_DIR"
chmod +x "$TARGET_DIR"/*.py

echo "[INFO] Restarting smartprint-agent.service..."
if systemctl is-active --quiet smartprint-agent.service 2>/dev/null; then
    systemctl restart smartprint-agent.service
    echo "[OK] smartprint-agent.service restarted with previous version."
fi

echo "=========================================================="
echo "[SUCCESS] SmartPrint Agent rolled back successfully."
echo "=========================================================="
