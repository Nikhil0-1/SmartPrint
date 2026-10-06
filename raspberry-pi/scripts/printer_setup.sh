#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - USB HP PRINTER DETECTION & CUPS CONFIGURATION SCRIPT
# Automatically discovers USB HP printers and registers the CUPS print queue.
# ==============================================================================

set -e

QUEUE_NAME="HP_LaserJet_USB"

echo "=================================================="
echo "    HP USB PRINTER DETECTION & CUPS SETUP        "
echo "=================================================="

# Check root
if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root: sudo bash printer_setup.sh"
  exit 1
fi

echo "[1/5] Checking USB bus for connected HP Printers..."
lsusb | grep -i "Hewlett-Packard\|HP" || {
  echo "[-] WARNING: No HP device found on USB bus."
  echo "    Please verify that:"
  echo "    1. The USB cable is firmly plugged into the Raspberry Pi and the HP printer."
  echo "    2. The printer is powered ON."
  echo "    3. The USB indicator light is active."
}

echo "[2/5] Querying CUPS hardware interfaces (lpinfo)..."
PRINTER_URI=$(lpinfo -v | grep -i "usb://.*hp" | awk '{print $2}' | head -n 1)

if [ -z "$PRINTER_URI" ]; then
  echo "[!] Specific HP USB URI not found directly via regex. Looking for any USB printer URI..."
  PRINTER_URI=$(lpinfo -v | grep -i "usb://" | awk '{print $2}' | head -n 1)
fi

if [ -z "$PRINTER_URI" ]; then
  echo "[-] Could not detect a valid USB printer URI via CUPS lpinfo."
  echo "    Falling back to standard generic USB URI: usb://HP/LaserJet"
  PRINTER_URI="usb://HP/LaserJet"
else
  echo "[+] Detected Printer Device URI: $PRINTER_URI"
fi

echo "[3/5] Checking available HP PPD / Drivers..."
# Look for hpcups driver or generic PPDF
HPCUPS_DRIVER=$(lpinfo -m | grep -i "hpcups.*laserjet" | head -n 1 | awk '{print $1}')

if [ -z "$HPCUPS_DRIVER" ]; then
  echo "[!] Exact LaserJet hpcups driver not found, checking generic postscript / PCL..."
  HPCUPS_DRIVER="drv:///sample.drv/generic.ppd"
fi
echo "[+] Selected driver: $HPCUPS_DRIVER"

echo "[4/5] Configuring CUPS Queue: $QUEUE_NAME..."
# Remove old queue if exists
lpadmin -x "$QUEUE_NAME" 2>/dev/null || true

# Add printer
lpadmin -p "$QUEUE_NAME" -E -v "$PRINTER_URI" -m "$HPCUPS_DRIVER" -D "GITAM SmartPrint USB HP Printer" -L "Kiosk 01"

# Enable and accept jobs
cupsenable "$QUEUE_NAME"
cupsaccept "$QUEUE_NAME"

# Set as system default printer
lpadmin -d "$QUEUE_NAME"

# Set default media to A4
lpoptions -p "$QUEUE_NAME" -o media=A4

echo "[+] Printer queue '$QUEUE_NAME' registered and enabled!"

echo "[5/5] Checking printer status via lpstat..."
lpstat -p "$QUEUE_NAME"
lpstat -d

echo "=================================================="
echo "Would you like to print a test page now? (y/N)"
read -r -t 10 DO_TEST || DO_TEST="n"

if [[ "$DO_TEST" =~ ^[Yy]$ ]]; then
  echo "[*] Sending test page to $QUEUE_NAME..."
  lp -d "$QUEUE_NAME" /usr/share/cups/data/testprint || echo "[-] Test page submission failed. Check CUPS logs."
  echo "[+] Test job submitted. Verify physical output on HP printer."
else
  echo "[*] Skipping test print."
fi

echo "=================================================="
echo "✓ PRINTER SETUP COMPLETED!"
echo "=================================================="
