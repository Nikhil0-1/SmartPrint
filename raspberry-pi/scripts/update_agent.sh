#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - CONTROLLED AGENT UPDATE SCRIPT
# Backs up the running agent version before updating files and restarts systemd service.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_DIR="/opt/smartprint/agent"
BACKUP_DIR="/opt/smartprint/agent_backup"

echo "=========================================================="
echo "  GITAM SMARTPRINT — AGENT UPDATE"
echo "=========================================================="

if [ "$EUID" -ne 0 ]; then
    echo "[ERROR] This script must be run as root (sudo)."
    exit 1
fi

echo "[INFO] Creating rollback backup at $BACKUP_DIR..."
rm -rf "$BACKUP_DIR"
if [ -d "$TARGET_DIR" ]; then
    cp -r "$TARGET_DIR" "$BACKUP_DIR"
fi

echo "[INFO] Deploying updated agent code..."
mkdir -p "$TARGET_DIR"
cp -r "${PI_DIR}/agent/"* "$TARGET_DIR/"
chmod +x "$TARGET_DIR"/*.py

echo "[INFO] Restarting smartprint-agent.service..."
if systemctl is-active --quiet smartprint-agent.service 2>/dev/null; then
    systemctl restart smartprint-agent.service
    echo "[OK] smartprint-agent.service restarted."
else
    echo "[INFO] smartprint-agent.service is not currently active."
fi

echo "=========================================================="
echo "[SUCCESS] SmartPrint Agent updated successfully."
echo "=========================================================="
