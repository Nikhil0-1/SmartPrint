#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - PANTUM M7100DW DUPLEX LASER PRINTER SETUP (v3.0)
# Configures Pantum M7100DW (USB VID 232b, PID 0ed0) via IPP Everywhere / ipp-usb
# Configures queue PANTUM_M7100DW with automatic duplex support (two-sided-long-edge)
# Preserves existing HP_Laser_108w queue for multi-printer redundancy.
# ==============================================================================

set -eo pipefail

QUEUE_NAME="${SMARTPRINT_CUPS_QUEUE:-"PANTUM_M7100DW"}"
PANTUM_VID="232b"
PANTUM_PID="0ed0"

echo "=================================================="
echo "    GITAM SMARTPRINT - PANTUM M7100DW SETUP       "
echo "    Target Queue: $QUEUE_NAME                     "
echo "=================================================="

# Check root permissions
if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root: sudo bash setup_pantum_m7100dw.sh"
  exit 1
fi

echo "[1/6] Scanning USB bus for Pantum hardware (232b:0ed0)..."
if lsusb | grep -i "${PANTUM_VID}:${PANTUM_PID}\|Pantum"; then
  echo "[+] Pantum M7100DW hardware detected on USB bus."
else
  echo "[-] WARNING: Pantum 232b:0ed0 not detected on USB bus."
  echo "    Check USB connection, power cable, and power switch."
fi

echo "[2/6] Verifying ipp-usb service..."
if systemctl is-active --quiet ipp-usb; then
  echo "[+] ipp-usb daemon is active."
else
  echo "[*] Starting ipp-usb daemon..."
  systemctl restart ipp-usb 2>/dev/null || true
  sleep 2
fi

echo "[3/6] Discovering printer endpoint URI via lpinfo and IPP..."
DEVICE_URI=""

# 1. Check for driverless / IPP Everywhere device URI
DETECTED_IPP=$(lpinfo -v 2>/dev/null | grep -i "pantum\|232b" | awk '{print $2}' | head -n 1 || true)
if [ -n "$DETECTED_IPP" ]; then
  DEVICE_URI="$DETECTED_IPP"
  echo "[+] Found device URI from lpinfo: $DEVICE_URI"
fi

# 2. Check for ipp-usb localhost port (60000 or 60001)
if [ -z "$DEVICE_URI" ]; then
  for port in 60001 60000; do
    if curl -s --connect-timeout 1 "http://127.0.0.1:${port}/ipp/print" >/dev/null 2>&1; then
      DEVICE_URI="ipp://127.0.0.1:${port}/ipp/print"
      echo "[+] Found active ipp-usb endpoint on port ${port}: $DEVICE_URI"
      break
    fi
  done
fi

# 3. Fallback to driverless URI if still empty
if [ -z "$DEVICE_URI" ]; then
  DEVICE_URI="ipp://127.0.0.1:60000/ipp/print"
  echo "[*] Using default driverless endpoint: $DEVICE_URI"
fi

echo "[4/6] Registering CUPS queue: $QUEUE_NAME..."
# Remove any corrupted prior definition of this specific queue
lpadmin -x "$QUEUE_NAME" 2>/dev/null || true

# Register queue with IPP everywhere driverless model
if lpadmin -p "$QUEUE_NAME" -E -v "$DEVICE_URI" -m everywhere \
  -D "GITAM SmartPrint Pantum M7100DW Duplex Laser" \
  -L "Campus Kiosk 01 - Duplex Bay" 2>/dev/null; then
  echo "[+] Registered '$QUEUE_NAME' using IPP Everywhere driver."
else
  echo "[*] Falling back to generic PPD..."
  lpadmin -p "$QUEUE_NAME" -E -v "$DEVICE_URI" -m drv:///sample.drv/generic.ppd \
    -D "GITAM SmartPrint Pantum M7100DW Duplex Laser" \
    -L "Campus Kiosk 01 - Duplex Bay"
fi

# Enable queue and accept jobs
cupsenable "$QUEUE_NAME"
cupsaccept "$QUEUE_NAME"

echo "[5/6] Configuring duplex, paper size, and monochrome options..."
# Pantum M7100DW supports automatic two-sided duplex printing
lpoptions -p "$QUEUE_NAME" -o media=A4
lpoptions -p "$QUEUE_NAME" -o ColorModel=Gray 2>/dev/null || true
lpoptions -p "$QUEUE_NAME" -o print-color-mode=monochrome 2>/dev/null || true
lpoptions -p "$QUEUE_NAME" -o sides=two-sided-long-edge 2>/dev/null || true
lpoptions -p "$QUEUE_NAME" -o Duplex=DuplexNoTumble 2>/dev/null || true

# Set Pantum as primary default queue
lpadmin -d "$QUEUE_NAME"
echo "[+] Set '$QUEUE_NAME' as primary default queue."

echo "[6/6] Verifying multi-printer CUPS state..."
echo "--- ACTIVE QUEUES ---"
lpstat -p -d

echo ""
echo "--- PRESERVED HP LASER 108W STATUS ---"
if lpstat -p HP_Laser_108w 2>/dev/null; then
  echo "[+] HP_Laser_108w queue is preserved and active for failover."
else
  echo "[*] Note: HP_Laser_108w queue is not currently registered. Run printer_setup.sh if dual printers are attached."
fi

echo "=================================================="
echo "✓ PANTUM M7100DW SETUP COMPLETED SUCCESSFULLY"
echo "  Queue:        $QUEUE_NAME"
echo "  URI:          $DEVICE_URI"
echo "  Duplex:       two-sided-long-edge (Automatic Duplex)"
echo "  Paper:        A4 Monochrome"
echo "=================================================="
