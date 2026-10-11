#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - CUPS CONFIGURATION SETUP SCRIPT (v2)
# Installs CUPS, HPLIP, configures queues for multi-printer kiosk setup.
# Compatible with Raspberry Pi OS (Debian Bookworm/Bullseye ARM).
# Run: sudo bash setup_cups.sh
# ==============================================================================

set -e
set -o pipefail

LOG_FILE="/var/log/smartprint/setup_cups.log"
mkdir -p /var/log/smartprint 2>/dev/null || true

log()  { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
info() { echo "  [INFO] $*" | tee -a "$LOG_FILE"; }
warn() { echo "  [WARN] $*" | tee -a "$LOG_FILE"; }
fail() { echo "  [FAIL] $*" | tee -a "$LOG_FILE"; exit 1; }

log "=============================================="
log "GITAM SMARTPRINT - CUPS SETUP (v2)"
log "=============================================="

if [ "$EUID" -ne 0 ]; then
  fail "Please run as root: sudo bash setup_cups.sh"
fi

# --- 1. Install CUPS and driver packages ---
log "[1/6] Installing CUPS, HPLIP, and ARM-compatible drivers..."
apt-get update -qq
apt-get install -y \
  cups \
  cups-client \
  cups-bsd \
  cups-filters \
  hplip \
  printer-driver-hpcups \
  printer-driver-foo2zjs \
  printer-driver-gutenprint \
  usbutils \
  avahi-daemon

log "Packages installed."

# --- 2. Enable and start CUPS ---
log "[2/6] Enabling and starting CUPS service..."
systemctl enable cups
systemctl start cups || systemctl restart cups
sleep 2
if systemctl is-active cups &>/dev/null; then
  log "CUPS service: RUNNING"
else
  fail "CUPS failed to start. Check: journalctl -u cups -n 50"
fi

# --- 3. Add pi user to lpadmin group (allow printer management) ---
log "[3/6] Configuring CUPS user permissions..."
CUPS_USER="${SUDO_USER:-pi}"
usermod -a -G lpadmin "$CUPS_USER" 2>/dev/null && log "Added $CUPS_USER to lpadmin group" || warn "Could not add user to lpadmin (may already be member)"

# --- 4. Configure CUPS to allow local admin and network access ---
log "[4/6] Configuring CUPS admin access..."
cupsctl --no-remote-admin --no-remote-any 2>/dev/null || true
cupsctl --share-printers 2>/dev/null || true
log "CUPS configured for local operation."

# --- 5. Detect USB printers ---
log "[5/6] Detecting USB printers via lpinfo..."
DETECTED_URIS=()
mapfile -t DETECTED_URIS < <(lpinfo -v 2>/dev/null | grep -i "usb://" | awk '{print $2}' || true)

if [ ${#DETECTED_URIS[@]} -eq 0 ]; then
  warn "No USB printer detected by CUPS. Connect printer and re-run detect_printers.sh."
  warn "When printer is connected, run: sudo bash printer_setup.sh"
else
  log "${#DETECTED_URIS[@]} USB printer URI(s) detected:"
  for uri in "${DETECTED_URIS[@]}"; do
    info "  $uri"
  done
fi

# --- 6. Status report ---
log "[6/6] CUPS Status Summary:"
lpstat -t 2>/dev/null | while read -r line; do info "$line"; done || info "(no queues configured yet)"
lpstat -d 2>/dev/null | while read -r line; do info "Default: $line"; done || true

log "=============================================="
log "CUPS SETUP COMPLETE"
log ""
log "Next steps:"
log "  1. Connect USB printer"
log "  2. sudo bash detect_printers.sh"
log "  3. sudo bash printer_setup.sh"
log "  4. sudo bash health_check.sh"
log "=============================================="
