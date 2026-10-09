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
lsusb | grep -i "Hewlett-Packard\|HP\|Printer" || {
  echo "[-] WARNING: No HP printer found on USB bus."
  echo "    Please verify cable connection and power state."
}

echo "[2/5] Querying CUPS hardware interfaces (lpinfo)..."
mapfile -t DETECTED_URIS < <(lpinfo -v | grep -i "usb://" | awk '{print $2}')

if [ ${#DETECTED_URIS[@]} -eq 0 ]; then
  echo "[-] Could not detect USB printer URIs via CUPS lpinfo."
  echo "    Falling back to standard USB URI: usb://HP/LaserJet"
  DETECTED_URIS=("usb://HP/LaserJet")
fi

echo "[+] Detected ${#DETECTED_URIS[@]} USB printer endpoint(s):"
for index in "${!DETECTED_URIS[@]}"; do
  echo "    [$((index+1))] ${DETECTED_URIS[$index]}"
done

echo "[3/5] Configuring CUPS Queues for Multi-Printer Kiosk..."

# Queue 1: B&W Primary Queue
BW_QUEUE="smartprint_bw_01"
BW_URI="${DETECTED_URIS[0]}"
HPCUPS_DRIVER=$(lpinfo -m | grep -i "hpcups.*laserjet" | head -n 1 | awk '{print $1}')
if [ -z "$HPCUPS_DRIVER" ]; then
  HPCUPS_DRIVER="drv:///sample.drv/generic.ppd"
fi

echo "[+] Registering B&W Queue: $BW_QUEUE -> $BW_URI"
lpadmin -x "$BW_QUEUE" 2>/dev/null || true
lpadmin -p "$BW_QUEUE" -E -v "$BW_URI" -m "$HPCUPS_DRIVER" -D "GITAM SmartPrint HP B&W Primary" -L "Kiosk 01 Tray 1"
cupsenable "$BW_QUEUE"
cupsaccept "$BW_QUEUE"
lpoptions -p "$BW_QUEUE" -o media=A4 -o ColorModel=K

# Queue 2: Color Primary Queue (if 2nd printer or color printer detected)
COLOR_QUEUE="smartprint_color_01"
COLOR_URI="${DETECTED_URIS[1]:-$BW_URI}"
echo "[+] Registering Color Queue: $COLOR_QUEUE -> $COLOR_URI"
lpadmin -x "$COLOR_QUEUE" 2>/dev/null || true
lpadmin -p "$COLOR_QUEUE" -E -v "$COLOR_URI" -m "$HPCUPS_DRIVER" -D "GITAM SmartPrint HP Color Primary" -L "Kiosk 01 Tray 2"
cupsenable "$COLOR_QUEUE"
cupsaccept "$COLOR_QUEUE"
lpoptions -p "$COLOR_QUEUE" -o media=A4 -o ColorModel=Color

# Set B&W as system default queue
lpadmin -d "$BW_QUEUE"

echo "[+] Multi-Printer CUPS queues successfully configured!"

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
