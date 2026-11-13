#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - HP LASER 108W / IPP-USB CUPS PRINTER SETUP (v3.0)
# Automatically configures HP Laser 108w via ipp-usb (ipp://127.0.0.1:60000/ipp/print)
# Configures strict monochrome parameters, enables queue, and sets system default.
# ==============================================================================

set -eo pipefail

QUEUE_NAME="${SMARTPRINT_CUPS_QUEUE:-"HP_Laser_108w"}"
IPP_USB_ENDPOINT="ipp://127.0.0.1:60000/ipp/print"

echo "=================================================="
echo "    GITAM SMARTPRINT - HP LASER 108W SETUP       "
echo "    Target Queue: $QUEUE_NAME                     "
echo "=================================================="

# Check root permissions
if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root: sudo bash printer_setup.sh"
  exit 1
fi

echo "[1/5] Checking USB bus for HP Laser 108w..."
lsusb | grep -i "Hewlett-Packard\|HP\|03f0:\|04e8:" || {
  echo "[-] WARNING: HP printer not detected on USB bus."
  echo "    Verify power cable and USB data cable connection."
}

echo "[2/5] Checking ipp-usb daemon..."
if systemctl is-active --quiet ipp-usb; then
  echo "[+] ipp-usb service is ACTIVE"
else
  echo "[*] Starting ipp-usb service..."
  systemctl start ipp-usb 2>/dev/null || echo "[-] ipp-usb service start warning."
fi

# Determine device URI (prefer ipp-usb endpoint if active)
DEVICE_URI="$IPP_USB_ENDPOINT"
if command -v curl &>/dev/null; then
  if ! curl -s --connect-timeout 2 http://127.0.0.1:60000/ipp/print >/dev/null 2>&1; then
    echo "[*] ipp-usb endpoint not responding on 60000. Checking lpinfo -v..."
    DETECTED_URI=$(lpinfo -v 2>/dev/null | grep -i "usb://\|ipp://.*60000" | awk '{print $2}' | head -n 1 || true)
    if [ -n "$DETECTED_URI" ]; then
      DEVICE_URI="$DETECTED_URI"
    fi
  fi
fi

echo "[3/5] Device URI configured: $DEVICE_URI"

echo "[4/5] Registering CUPS queue: $QUEUE_NAME..."
# Remove any conflicting older queue
lpadmin -x "$QUEUE_NAME" 2>/dev/null || true

# Register queue with IPP everywhere driverless support
lpadmin -p "$QUEUE_NAME" -E -v "$DEVICE_URI" -m everywhere \
  -D "GITAM SmartPrint HP Laser 108w" \
  -L "Campus Kiosk 01" 2>/dev/null || \
lpadmin -p "$QUEUE_NAME" -E -v "$DEVICE_URI" -m drv:///sample.drv/generic.ppd \
  -D "GITAM SmartPrint HP Laser 108w" \
  -L "Campus Kiosk 01"

# Enable queue and accept jobs
cupsenable "$QUEUE_NAME"
cupsaccept "$QUEUE_NAME"

# Configure strict monochrome options (HP Laser 108w is strictly monochrome)
lpoptions -p "$QUEUE_NAME" -o media=A4 -o ColorModel=Gray -o print-color-mode=monochrome

# Set as system default queue
lpadmin -d "$QUEUE_NAME"
echo "[+] '$QUEUE_NAME' configured and set as system default queue."

echo "[5/5] Verifying queue status..."
lpstat -p "$QUEUE_NAME"
lpstat -d

echo "=================================================="
echo "✓ PRINTER SETUP COMPLETED FOR $QUEUE_NAME"
echo "=================================================="
