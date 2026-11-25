#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - FIRST TIME RASPBERRY PI SETUP
# Run this ONCE on a fresh Raspberry Pi to clone the repo and start the agent.
#
# Usage (copy-paste in Pi SSH terminal):
#   curl -fsSL https://raw.githubusercontent.com/Nikhil0-1/SmartPrint/main/raspberry-pi/scripts/first_time_setup.sh | sudo bash
#
# Or, if you have the repo already on Windows, copy this file to Pi and run:
#   sudo bash first_time_setup.sh
# ==============================================================================

set -eo pipefail

REPO_URL="https://github.com/Nikhil0-1/SmartPrint.git"
INSTALL_DIR="/home/smartprint/SmartPrint"
AGENT_USER="smartprint"

echo "========================================================"
echo "  GITAM SMARTPRINT — FIRST TIME PI SETUP"
echo "========================================================"

# 1. Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root: sudo bash first_time_setup.sh"
  exit 1
fi

# 2. Update system and install dependencies
echo "[1/7] Installing system dependencies..."
apt-get update -qq
apt-get install -y --no-install-recommends \
  git python3 python3-pip python3-pil \
  libreoffice-writer libreoffice-impress libreoffice-calc \
  cups cups-client libcups2-dev \
  ipp-usb \
  2>/dev/null || true

# Install python cups binding
pip3 install pycups --quiet 2>/dev/null || true

echo "[+] Dependencies installed."

# 3. Create smartprint user if not exists
if ! id -u "$AGENT_USER" >/dev/null 2>&1; then
  echo "[2/7] Creating '$AGENT_USER' system user..."
  adduser --system --group --home "/home/$AGENT_USER" "$AGENT_USER"
fi

# Add to lpadmin group for CUPS access
usermod -aG lpadmin "$AGENT_USER" 2>/dev/null || true

# 4. Clone or update repository
echo "[3/7] Cloning SmartPrint repository..."
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "[+] Repository already exists. Pulling latest..."
  git -C "$INSTALL_DIR" fetch origin main --quiet
  git -C "$INSTALL_DIR" reset --hard origin/main --quiet
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

chown -R "$AGENT_USER:$AGENT_USER" "$INSTALL_DIR" 2>/dev/null || chown -R root:root "$INSTALL_DIR"
echo "[+] Repository ready at $INSTALL_DIR"

# 5. Create required directories
echo "[4/7] Setting up system directories..."
mkdir -p /etc/smartprint /var/lib/smartprint /var/log/smartprint
chmod 755 /var/lib/smartprint /var/log/smartprint /etc/smartprint

# 6. Create agent config if not present
CONFIG_FILE="/etc/smartprint/agent_config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "[5/7] Creating default agent config..."
  cat > "$CONFIG_FILE" <<'CFGEOF'
{
  "backend_url": "https://smart-prints.vercel.app",
  "kiosk_id": "GITAM-SPK-001",
  "device_token": "REPLACE_WITH_YOUR_DEVICE_TOKEN",
  "organization_id": "",
  "poll_interval_sec": 1.5,
  "heartbeat_interval_sec": 10,
  "outbox_interval_sec": 2,
  "verify_ssl": true,
  "cups_queue": "PANTUM_M7100DW",
  "max_pdf_size_mb": 50,
  "job_timeout_seconds": 180
}
CFGEOF
  echo "[!] IMPORTANT: Edit $CONFIG_FILE and set your device_token before starting the service!"
else
  echo "[5/7] Agent config already exists at $CONFIG_FILE — skipping."
fi

# 7. Install and enable systemd service using enable_autostart.sh
echo "[6/7] Installing systemd service..."
bash "$INSTALL_DIR/raspberry-pi/scripts/enable_autostart.sh"

# 8. Enable and start CUPS + ipp-usb
echo "[7/7] Enabling CUPS and ipp-usb services..."
systemctl enable cups ipp-usb 2>/dev/null || true
systemctl start cups 2>/dev/null || true
systemctl start ipp-usb 2>/dev/null || true

echo "========================================================"
echo "  SETUP COMPLETE!"
echo ""
echo "  NEXT STEPS:"
echo "  1. Set your device token:"
echo "     sudo nano /etc/smartprint/agent_config.json"
echo "     (Replace REPLACE_WITH_YOUR_DEVICE_TOKEN with actual token)"
echo ""
echo "  2. Restart the agent after editing config:"
echo "     sudo systemctl restart smartprint-agent"
echo ""
echo "  3. Check status:"
echo "     sudo systemctl status smartprint-agent"
echo "     sudo journalctl -u smartprint-agent -f"
echo "========================================================"
