#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - RASPBERRY PI DEVICE REGISTRATION SCRIPT
# Provisions device credentials, verifies authentication with the backend,
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
    echo "[ERROR] This script must be run as root (sudo)." >&2
    exit 1
fi

BACKEND_URL="${1:-${SMARTPRINT_BACKEND_URL:-}}"
KIOSK_ID="${2:-${SMARTPRINT_KIOSK_ID:-}}"
DEVICE_TOKEN="${3:-${SMARTPRINT_DEVICE_TOKEN:-}}"
ORG_ID="${4:-${SMARTPRINT_ORG_ID:-}}"

# Interactive prompt fallback if arguments not provided
if [ -z "$BACKEND_URL" ]; then
    read -rp "Enter Backend Base URL [https://smart-prints.vercel.app]: " input_backend
    BACKEND_URL="${input_backend:-https://smart-prints.vercel.app}"
fi

if [ -z "$KIOSK_ID" ]; then
    read -rp "Enter Kiosk ID (e.g., GITAM-SPK-001): " KIOSK_ID
fi

if [ -z "$DEVICE_TOKEN" ]; then
    read -rsp "Enter Secret Device Token: " DEVICE_TOKEN
    echo ""
fi

if [ -z "$KIOSK_ID" ] || [ -z "$DEVICE_TOKEN" ]; then
    echo "[ERROR] Both Kiosk ID and Device Token are required to register this device." >&2
    echo "Usage: sudo bash register_device.sh <backend_url> <kiosk_id> <device_token> [org_id]" >&2
    exit 1
fi

echo "[INFO] Backend URL:      $BACKEND_URL"
echo "[INFO] Kiosk ID:         $KIOSK_ID"
echo "[INFO] Device Token:     ${DEVICE_TOKEN:0:4}********"
if [ -n "$ORG_ID" ]; then
    echo "[INFO] Organization ID:  $ORG_ID"
fi

# --- 1. VERIFY CREDENTIALS AGAINST BACKEND SERVER ---
echo "[INFO] Verifying device credentials with backend..."
HEARTBEAT_ENDPOINT="${BACKEND_URL%/}/api/kiosk/heartbeat"

HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$HEARTBEAT_ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "X-Kiosk-Id: $KIOSK_ID" \
    -H "X-Device-Token: $DEVICE_TOKEN" \
    -d "{\"kiosk_id\":\"$KIOSK_ID\",\"agent_version\":\"1.0.0\"}" || echo -e "\n000")

HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -n1)

if [ "$HTTP_CODE" -eq 200 ]; then
    echo "[OK] Backend authentication successful (HTTP 200). Kiosk record verified."
elif [ "$HTTP_CODE" -eq 401 ] || [ "$HTTP_CODE" -eq 403 ]; then
    echo "[ERROR] Backend authentication failed (HTTP $HTTP_CODE): $HTTP_BODY" >&2
    echo "[ERROR] Invalid device credentials. Registration aborted." >&2
    exit 1
elif [ "$HTTP_CODE" -eq 404 ]; then
    echo "[ERROR] Backend returned HTTP 404: Kiosk ID '$KIOSK_ID' is not registered in the database." >&2
    exit 1
else
    echo "[ERROR] Backend verification failed with HTTP $HTTP_CODE: $HTTP_BODY" >&2
    echo "[ERROR] Ensure backend is running and reachable. Registration aborted." >&2
    exit 1
fi

# --- 2. GENERATE SECURE RESTRICTED CONFIGURATION ---
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

cat <<EOF > "$CONFIG_FILE"
{
  "backend_url": "$BACKEND_URL",
  "organization_id": "$ORG_ID",
  "kiosk_id": "$KIOSK_ID",
  "device_token": "$DEVICE_TOKEN",
  "poll_interval_sec": 4,
  "heartbeat_interval_sec": 10,
  "verify_ssl": true,
  "temp_spool_dir": "/var/lib/smartprint/jobs",
  "local_state_db": "/var/lib/smartprint/agent_state.db"
}
EOF

chmod 600 "$CONFIG_FILE"
chown -R root:root "$CONFIG_DIR"

# Ensure spool and state directories exist with restricted permissions
mkdir -p /var/lib/smartprint/jobs
chmod 700 /var/lib/smartprint
chmod 700 /var/lib/smartprint/jobs

echo "[OK] Generated configuration at $CONFIG_FILE with secure 0600 permissions."
echo "=========================================================="
echo "[SUCCESS] Device registered and verified successfully for Kiosk $KIOSK_ID."
echo "=========================================================="
