#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - ENABLE PERMANENT AUTO-START ON BOOT
# Run once on Raspberry Pi: sudo bash raspberry-pi/scripts/enable_autostart.sh
# ==============================================================================

set -eo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root: sudo bash enable_autostart.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=========================================================="
echo "  GITAM SMARTPRINT — PERMANENT AUTO-START CONFIGURATION   "
echo "  Target Repo: $REPO_DIR                                  "
echo "=========================================================="

# 1. Install smartprint_launcher.sh to /usr/local/bin
LAUNCHER_PATH="/usr/local/bin/smartprint-agent-launcher"
cp "$SCRIPT_DIR/smartprint_launcher.sh" "$LAUNCHER_PATH"
chmod +x "$LAUNCHER_PATH"
chmod +x "$SCRIPT_DIR"/*.sh
chmod +x "$REPO_DIR/raspberry-pi/agent"/*.py
echo "[+] Installed launcher to $LAUNCHER_PATH"

# 2. Create required system directories and permissions
mkdir -p /etc/smartprint /var/lib/smartprint /var/log/smartprint
chmod 755 /var/lib/smartprint /var/log/smartprint /etc/smartprint

# 3. Configure systemd service
SERVICE_FILE="/etc/systemd/system/smartprint-agent.service"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=GITAM SMARTPRINT Raspberry Pi Production Agent Service
After=network.target cups.service ipp-usb.service
Wants=cups.service
Documentation=https://github.com/Nikhil0-1/SmartPrint

[Service]
Type=simple
User=root
WorkingDirectory=$REPO_DIR
Environment=PYTHONUNBUFFERED=1
Environment=SMARTPRINT_CONFIG=/etc/smartprint/agent_config.json
Environment=SMARTPRINT_STATE_DIR=/var/lib/smartprint
Environment=SMARTPRINT_CUPS_QUEUE=PANTUM_M7100DW

ExecStart=$LAUNCHER_PATH

Restart=always
RestartSec=3
KillMode=process
KillSignal=SIGTERM
TimeoutStopSec=15

StandardOutput=journal
StandardError=journal
SyslogIdentifier=smartprint-agent

[Install]
WantedBy=multi-user.target
EOF

echo "[+] Configured $SERVICE_FILE"

# 4. Enable and start service
systemctl daemon-reload
systemctl enable smartprint-agent.service
systemctl restart smartprint-agent.service

echo "[+] Service enabled for automatic start on power-up / boot."
sleep 2

if systemctl is-active --quiet smartprint-agent.service; then
  echo "=========================================================="
  echo "✓ SUCCESS: smartprint-agent is ACTIVE and RUNNING!"
  echo "  It will now start automatically whenever power is restored."
  echo "=========================================================="
else
  echo "[-] Warning: Service started, check status with: systemctl status smartprint-agent"
fi
