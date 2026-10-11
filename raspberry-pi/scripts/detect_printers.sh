#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - USB PRINTER DETECTION SCRIPT (v2)
# Detects all connected USB printers, queries CUPS URIs, checks driver compatibility.
# Run: sudo bash detect_printers.sh
# OUTPUT: /etc/smartprint/detected_printers.json (machine-readable summary)
# ==============================================================================

set -o pipefail

OUTPUT_JSON="/etc/smartprint/detected_printers.json"
LOG_FILE="/var/log/smartprint/detect_printers.log"

mkdir -p /etc/smartprint /var/log/smartprint 2>/dev/null || true

log()  { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
info() { echo "  [INFO] $*" | tee -a "$LOG_FILE"; }
warn() { echo "  [WARN] $*" | tee -a "$LOG_FILE"; }

log "========================================================"
log "GITAM SMARTPRINT - PRINTER DETECTION (v2)"
log "========================================================"

PRINTERS_JSON="[]"

# --- Step 1: lsusb inventory ---
log "[1/5] USB Bus Enumeration (lsusb)..."
if ! command -v lsusb &>/dev/null; then
  warn "lsusb not found. Install: sudo apt-get install -y usbutils"
else
  USB_LINES=$(lsusb 2>/dev/null || true)
  log "USB devices on bus:"
  echo "$USB_LINES" | grep -i "HP\|Canon\|Epson\|Brother\|Hewlett\|Xerox\|Printer" | while read -r line; do
    info "$line"
  done
  USB_PRINTER_COUNT=$(echo "$USB_LINES" | grep -ic "HP\|Canon\|Epson\|Brother\|Hewlett\|Xerox\|Printer" || true)
  log "Printer-class USB devices detected: $USB_PRINTER_COUNT"
fi

# --- Step 2: CUPS lpinfo URI discovery ---
log "[2/5] CUPS Device URI Discovery (lpinfo -v)..."
if ! command -v lpinfo &>/dev/null; then
  warn "lpinfo not found — CUPS not installed. Run install.sh first."
  URIS=()
else
  mapfile -t URIS < <(lpinfo -v 2>/dev/null | grep -i "usb://\|hp://\|dnssd://\|socket://\|ipp://" | awk '{print $2}' || true)
  if [ ${#URIS[@]} -gt 0 ]; then
    log "CUPS printer URIs found: ${#URIS[@]}"
    for uri in "${URIS[@]}"; do info "  URI: $uri"; done
  else
    warn "No printer URIs detected by CUPS (lpinfo -v returned nothing)."
    warn "Check that printer is connected, powered on, and USB cable is data-capable."
  fi
fi

# --- Step 3: CUPS existing queues ---
log "[3/5] Existing CUPS Print Queues (lpstat -t)..."
if command -v lpstat &>/dev/null; then
  QUEUES=$(lpstat -t 2>/dev/null || echo "CUPS not running or no queues.")
  log "Queue status:"
  echo "$QUEUES" | while read -r line; do info "  $line"; done
fi

# --- Step 4: Available drivers (lpinfo -m) ---
log "[4/5] Driver compatibility check (lpinfo -m)..."
if command -v lpinfo &>/dev/null; then
  # HP HPLIP / HPCUPS
  HP_DRIVERS=$(lpinfo -m 2>/dev/null | grep -i "hpcups\|hpijs\|HP" | head -20 || true)
  if [ -n "$HP_DRIVERS" ]; then
    log "HP drivers available in CUPS:"
    echo "$HP_DRIVERS" | while read -r d; do info "  $d"; done
  else
    warn "No HP drivers found via lpinfo -m. hplip/printer-driver-hpcups may not be installed."
    warn "Install with: sudo apt-get install -y hplip printer-driver-hpcups"
  fi

  # Generic/driverless
  GENERIC_DRIVERS=$(lpinfo -m 2>/dev/null | grep -i "generic\|everywhere\|ipp\|driverless" | head -10 || true)
  if [ -n "$GENERIC_DRIVERS" ]; then
    log "Generic/IPP driverless drivers available:"
    echo "$GENERIC_DRIVERS" | while read -r d; do info "  $d"; done
  fi
fi

# --- Step 5: Output JSON report ---
log "[5/5] Writing machine-readable detection report..."
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
URI_JSON="["
FIRST=1
for uri in "${URIS[@]}"; do
  [ $FIRST -eq 0 ] && URI_JSON+=","
  # Extract manufacturer and model from URI if possible
  MANUF=$(echo "$uri" | sed 's|usb://||;s|/.*||' | tr '%20' ' ')
  MODEL=$(echo "$uri" | sed 's|usb://[^/]*/||;s|?.*||' | tr '%20' ' ')
  URI_JSON+="{\"uri\":\"$uri\",\"manufacturer\":\"$MANUF\",\"model\":\"$MODEL\",\"connection\":\"USB\"}"
  FIRST=0
done
URI_JSON+="]"

cat > "$OUTPUT_JSON" <<EOF
{
  "detected_at": "$TIMESTAMP",
  "usb_printer_count": ${#URIS[@]},
  "detected_printers": $URI_JSON,
  "hplip_installed": $(command -v hp-setup &>/dev/null && echo "true" || echo "false"),
  "cups_running": $(systemctl is-active cups &>/dev/null && echo "true" || echo "false"),
  "hostname": "$(hostname)",
  "note": "Run detect_printers.sh as root for full CUPS URI detection. Connect printer before running."
}
EOF

log "========================================================"
log "DETECTION COMPLETE — Report: $OUTPUT_JSON"
log "========================================================"
echo ""
echo "Detection summary:"
if command -v jq &>/dev/null; then
  cat "$OUTPUT_JSON" | jq .
else
  cat "$OUTPUT_JSON"
fi
echo ""

if [ ${#URIS[@]} -gt 0 ]; then
  echo "✓ Printer(s) detected. Run: sudo bash printer_setup.sh"
else
  echo "⚠ No printer URIs detected."
  echo "  1. Connect printer USB cable to Raspberry Pi"
  echo "  2. Power on printer"
  echo "  3. Run: sudo bash detect_printers.sh"
  echo ""
  echo "  If still not detected, check:"
  echo "    - USB cable is data-capable (not charge-only)"
  echo "    - Printer is not in sleep/standby mode"
  echo "    - lsusb output: $(lsusb 2>/dev/null | grep -i 'HP\|Canon' || echo 'no HP/Canon found')"
fi
