#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - RASPBERRY PI 3B+ AUTOMATED INSTALLATION SCRIPT
# Configures CUPS, HPLIP, Python 3, Chromium Kiosk, and Systemd Services
# ==============================================================================

set -e

echo "=================================================="
echo "   GITAM SMARTPRINT - RASPBERRY PI INSTALLER     "
echo "   Powered by Nikhil | Support: 9006496970       "
echo "=================================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root (sudo bash install.sh)"
  exit 1
fi

echo "[1/8] Updating package lists..."
apt-get update -y

echo "[2/8] Installing core system packages, CUPS, and HPLIP..."
apt-get install -y \
  cups \
  cups-client \
  cups-bsd \
  hplip \
  printer-driver-hpcups \
  python3 \
  python3-pip \
  python3-cups \
  python3-requests \
  python3-urllib3 \
  python3-venv \
  chromium-browser \
  unclutter \
  xdotool \
  curl \
  jq \
  coreutils \
  procps

echo "[3/8] Configuring CUPS permissions..."
TARGET_USER="${SUDO_USER:-smartprint}"
usermod -a -G lpadmin "$TARGET_USER" || true
usermod -a -G lp "$TARGET_USER" || true
systemctl enable cups
systemctl restart cups

# Configure CUPS for secure local operation (no broad remote admin)
cupsctl --no-remote-admin --no-remote-any || true

echo "[4/8] Creating secure directories with restricted permissions..."
mkdir -p /var/lib/smartprint/jobs
mkdir -p /etc/smartprint
mkdir -p /var/log/smartprint

# Restricted permissions to protect customer documents and credentials
chmod 700 /var/lib/smartprint/jobs
chmod 700 /var/lib/smartprint
chmod 700 /etc/smartprint
chmod 755 /var/log/smartprint

echo "[5/8] Verifying Python dependencies..."
python3 -c "import cups, requests, urllib3; print('[+] Python dependencies verified successfully.')" 2>/dev/null || {
  echo "[*] Installing fallback Python dependencies..."
  python3 -m pip install --break-system-packages pycups requests urllib3 || pip3 install pycups requests urllib3 || true
}

echo "[6/8] Checking Kiosk Registration..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f /etc/smartprint/agent_config.json ]; then
  echo "[*] Device configuration not found. Run 'sudo bash $SCRIPT_DIR/register_device.sh' to authenticate and register this kiosk."
else
  echo "[+] Existing device configuration found at /etc/smartprint/agent_config.json"
fi

echo "[7/8] Installing Systemd Services..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

cp "$PARENT_DIR/systemd/smartprint-agent.service" /etc/systemd/system/smartprint-agent.service
cp "$PARENT_DIR/systemd/smartprint-kiosk.service" /etc/systemd/system/smartprint-kiosk.service

systemctl daemon-reload
systemctl enable smartprint-agent.service
systemctl enable smartprint-kiosk.service

echo "[8/8] Running Initial Boot Cleanup Routine..."
bash "$SCRIPT_DIR/cleanup.sh"

echo "=================================================="
echo "✓ INSTALLATION COMPLETED SUCCESSFULLY!"
echo "Next Steps:"
echo "1. Connect HP Printer via USB Cable."
echo "2. Run: sudo bash $SCRIPT_DIR/printer_setup.sh"
echo "3. Run: sudo bash $SCRIPT_DIR/health_check.sh"
echo "4. Start services: sudo systemctl start smartprint-agent smartprint-kiosk"
echo "=================================================="
