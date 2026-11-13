#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - CUPS & IPP-USB SETUP SCRIPT (v3.0)
# Installs CUPS, ipp-usb, python3-cups, and configures for HP Laser 108w.
# Compatible with Raspberry Pi OS (Debian 12 Bookworm / Debian 13 Trixie ARM64).
# ==============================================================================

set -eo pipefail

LOG_FILE="/var/log/smartprint/setup_cups.log"
mkdir -p /var/log/smartprint 2>/dev/null || true

log()  { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
info() { echo "  [INFO] $*" | tee -a "$LOG_FILE"; }
warn() { echo "  [WARN] $*" | tee -a "$LOG_FILE"; }
fail() { echo "  [FAIL] $*" | tee -a "$LOG_FILE"; exit 1; }

log "=============================================="
log "GITAM SMARTPRINT - CUPS & IPP-USB SETUP (v3.0)"
log "=============================================="

if [ "$EUID" -ne 0 ]; then
  fail "Please run as root: sudo bash setup_cups.sh"
fi

# --- 1. Install CUPS, ipp-usb, and system Python PyCUPS ---
log "[1/6] Installing CUPS, ipp-usb, python3-cups, and driver packages..."
apt-get update -qq
apt-get install -y \
  cups \
  cups-client \
  cups-bsd \
  cups-filters \
  ipp-usb \
  python3-cups \
  usbutils \
  avahi-daemon

log "Packages installed successfully."

# --- 2. Enable and start CUPS & ipp-usb ---
log "[2/6] Enabling and starting CUPS and ipp-usb services..."
systemctl enable cups
systemctl restart cups
systemctl enable ipp-usb 2>/dev/null || true
systemctl restart ipp-usb 2>/dev/null || true
sleep 2

if systemctl is-active cups &>/dev/null; then
  log "CUPS service: RUNNING"
else
  fail "CUPS failed to start. Check: journalctl -u cups -n 50"
fi

# --- 3. Configure user permissions for smartprint user ---
log "[3/6] Configuring CUPS user permissions for smartprint user..."
for user_candidate in smartprint pi "${SUDO_USER:-}"; do
  if [ -n "$user_candidate" ] && id "$user_candidate" &>/dev/null; then
    usermod -a -G lp,lpadmin "$user_candidate" 2>/dev/null && log "Added $user_candidate to lp and lpadmin groups" || true
  fi
done

# --- 4. Secure CUPS admin access for local kiosk operations ---
log "[4/6] Configuring CUPS admin access..."
cupsctl --no-remote-admin --no-remote-any --no-share-printers 2>/dev/null || true
log "CUPS configured securely for local operations."

# --- 5. Printer Setup execution ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/printer_setup.sh" ]; then
  log "[5/6] Executing printer_setup.sh for HP Laser 108w..."
  bash "${SCRIPT_DIR}/printer_setup.sh" || warn "Printer setup returned non-zero. Connect printer and re-run."
fi

# --- 6. Summary ---
log "[6/6] CUPS & IPP-USB Setup Complete."
lpstat -p 2>/dev/null | while read -r line; do info "$line"; done || true
lpstat -d 2>/dev/null | while read -r line; do info "Default: $line"; done || true

log "=============================================="
log "CUPS SETUP COMPLETED"
log "=============================================="
