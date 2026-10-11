#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - RASPBERRY PI DEVICE REGISTRATION SCRIPT
# Securely provisions device token, binds to Organization & Kiosk ID,
# and generates restrictive local configuration at /etc/smartprint/agent_config.json.
# ==============================================================================

set -euo pipefail

CONFIG_DIR="/etc/smartprint"
CONFIG_FILE="${CONFIG_DIR}/agent_config.json"

echo "=========================================================="
echo "  GITAM SMARTPRINT — DEVICE PROVISIONING & REGISTRATION"
echo "=========================================================="

# Check root permissions
if [ "$EUID" -ne 0 ]; then
    echo "[ERROR] This script must be run as root (sudo)."
    exit 1
fi

BACKEND_URL="${1:-http://localhost:3000}"
ORG_ID="${2:-00000000-0000-0000-0000-000000000001}"
KIOSK_ID="${3:-GITAM-SPK-001}"
DEVICE_TOKEN="${4:-gitam_spk_001_secure_device_secret_2026}"

echo "[INFO] Backend URL:      $BACKEND_URL"
echo "[INFO] Organization ID:  $ORG_ID"
echo "[INFO] Kiosk ID:         $KIOSK_ID"
echo "[INFO] Device Token:     ${DEVICE_TOKEN:0:8}********"

# Create config directory with restricted permissions (0700)
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

# Generate agent configuration JSON
cat <<EOF > "$CONFIG_FILE"
{
  "backend_url": "$BACKEND_URL",
  "organization_id": "$ORG_ID",
  "kiosk_id": "$KIOSK_ID",
  "device_token": "$DEVICE_TOKEN",
  "poll_interval_sec": 4,
  "heartbeat_interval_sec": 10,
  "temp_spool_dir": "/var/lib/smartprint/jobs",
  "local_state_db": "/var/lib/smartprint/agent_state.db",
  "max_spool_retention_minutes": 15
}
EOF

# Restrict config file permissions (0600 - root only)
chmod 600 "$CONFIG_FILE"
chown -R root:root "$CONFIG_DIR"

# Ensure spool directories exist
mkdir -p /var/lib/smartprint/jobs
chmod 700 /var/lib/smartprint
chmod 700 /var/lib/smartprint/jobs

echo "[OK] Generated configuration at $CONFIG_FILE with secure 0600 permissions."

# Test backend connectivity
echo "[INFO] Verifying backend health ping..."
if curl -sf "${BACKEND_URL}/api/health" > /dev/null; then
    echo "[OK] Backend connectivity confirmed: ${BACKEND_URL}/api/health is reachable."
else
    echo "[WARN] Could not reach ${BACKEND_URL}/api/health. Ensure backend is running or network is up."
fi

echo "=========================================================="
echo "[SUCCESS] Device registered successfully for Kiosk $KIOSK_ID."
echo "=========================================================="
