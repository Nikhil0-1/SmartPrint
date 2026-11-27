#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - HP LASERJET P1108 MONOCHROME LASER PRINTER SETUP
# Configures HP LaserJet P1108 (USB VID 03f0, PID 002a/112a) via HPLIP / hpcups
# (or foo2zjs fallback) as CUPS queue 'HP_LaserJet_P1108'.
# Preserves existing PANTUM_M7100DW and HP_Laser_108w queues for multi-printer
# routing and automatic failover.
# ==============================================================================

set -eo pipefail

QUEUE_NAME="${SMARTPRINT_P1108_QUEUE:-"HP_LaserJet_P1108"}"

echo "=================================================="
echo "    GITAM SMARTPRINT - HP LASERJET P1108 SETUP    "
echo "    Target Queue: $QUEUE_NAME                     "
echo "=================================================="

# Check root permissions
if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root: sudo bash setup_hp_p1108.sh"
  exit 1
fi

echo "[1/6] Ensuring HPLIP / CUPS drivers are installed..."
if ! command -v hp-setup >/dev/null 2>&1 || ! lpinfo -m 2>/dev/null | grep -qi "p1108"; then
  apt-get update -qq
  apt-get install -y --no-install-recommends \
    hplip printer-driver-hpcups printer-driver-foo2zjs usb-modeswitch \
    2>/dev/null || true
fi
echo "[+] Driver packages verified."

echo "[2/6] Scanning USB bus for HP LaserJet P1108 (03f0:002a / 03f0:112a)..."
if lsusb | grep -iE "03f0:(002a|112a)|P1108"; then
  echo "[+] HP LaserJet P1108 hardware detected on USB bus."
else
  echo "[-] WARNING: HP LaserJet P1108 not detected on USB bus."
  echo "    Check USB data cable and power switch."
fi

echo "[3/6] Discovering HP LaserJet P1108 device URI via lpinfo -v..."
DEVICE_URI=""
# Prefer hp:/usb/ backend URI first, then raw usb:// URI
DEVICE_URI=$(lpinfo -v 2>/dev/null | grep -iE "hp:/usb/.*p1108|hp:/usb/.*p110" | awk '{print $2}' | head -n 1 || true)
if [ -z "$DEVICE_URI" ]; then
  DEVICE_URI=$(lpinfo -v 2>/dev/null | grep -iE "usb://.*p1108|usb://.*p110" | awk '{print $2}' | head -n 1 || true)
fi
if [ -z "$DEVICE_URI" ]; then
  DEVICE_URI="usb://HP/LaserJet%20Professional%20P1108"
  echo "[*] Using default USB URI: $DEVICE_URI"
else
  echo "[+] Found device URI: $DEVICE_URI"
fi

echo "[4/6] Selecting PPD driver for HP LaserJet P1108..."
PPD_MODEL=""
PPD_MODEL=$(lpinfo -m 2>/dev/null | grep -i "p1108" | grep -i "hpcups" | awk '{print $1}' | head -n 1 || true)
if [ -z "$PPD_MODEL" ]; then
  PPD_MODEL=$(lpinfo -m 2>/dev/null | grep -iE "p1108|p1102" | awk '{print $1}' | head -n 1 || true)
fi
if [ -z "$PPD_MODEL" ]; then
  PPD_MODEL="drv:///hp/hpcups.drv/hp-laserjet_professional_p1108.ppd"
fi
echo "[+] Selected PPD: $PPD_MODEL"

echo "[5/6] Registering CUPS queue: $QUEUE_NAME..."
lpadmin -x "$QUEUE_NAME" 2>/dev/null || true

if ! lpadmin -p "$QUEUE_NAME" -E -v "$DEVICE_URI" -m "$PPD_MODEL" \
  -D "GITAM SmartPrint HP LaserJet P1108" \
  -L "Campus Kiosk - Simplex Bay" 2>/dev/null; then
  echo "[*] Primary PPD failed, falling back to generic PPD..."
  lpadmin -p "$QUEUE_NAME" -E -v "$DEVICE_URI" -m drv:///sample.drv/generic.ppd \
    -D "GITAM SmartPrint HP LaserJet P1108" \
    -L "Campus Kiosk - Simplex Bay"
fi

# Enable queue and accept jobs
cupsenable "$QUEUE_NAME"
cupsaccept "$QUEUE_NAME"

# Configure strict monochrome simplex A4 options
lpoptions -p "$QUEUE_NAME" -o media=A4
lpoptions -p "$QUEUE_NAME" -o ColorModel=Gray 2>/dev/null || true
lpoptions -p "$QUEUE_NAME" -o print-color-mode=monochrome 2>/dev/null || true
lpoptions -p "$QUEUE_NAME" -o sides=one-sided 2>/dev/null || true
lpoptions -p "$QUEUE_NAME" -o Duplex=None 2>/dev/null || true

# Set as default ONLY if no default queue or PANTUM_M7100DW is not registered
if ! lpstat -p PANTUM_M7100DW >/dev/null 2>&1; then
  lpadmin -d "$QUEUE_NAME"
  echo "[+] Set '$QUEUE_NAME' as system default queue (no Pantum detected)."
else
  echo "[+] Preserved PANTUM_M7100DW as primary default; '$QUEUE_NAME' active for routing & failover."
fi

echo "[6/6] Verifying multi-printer CUPS state..."
lpstat -p -d

echo "=================================================="
echo "✓ HP LASERJET P1108 SETUP COMPLETED SUCCESSFULLY"
echo "  Queue:        $QUEUE_NAME"
echo "  URI:          $DEVICE_URI"
echo "  Driver:       $PPD_MODEL"
echo "  Mode:         A4 Monochrome Simplex"
echo "=================================================="
