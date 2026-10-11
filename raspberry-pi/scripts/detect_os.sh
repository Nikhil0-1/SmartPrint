#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - RASPBERRY PI OS & HARDWARE ARCHITECTURE DETECTOR
# Verifies Linux distribution, ARM architecture (v7/v8/aarch64), kernel, and CUPS compatibility.
# ==============================================================================

set -euo pipefail

echo "=========================================================="
echo "  GITAM SMARTPRINT — OS & ARCHITECTURE DETECTION"
echo "=========================================================="

ARCH=$(uname -m)
KERNEL=$(uname -r)
HOSTNAME=$(hostname)

echo "[INFO] Hostname:      $HOSTNAME"
echo "[INFO] Architecture:  $ARCH"
echo "[INFO] Kernel:        $KERNEL"

# Detect OS Release
if [ -f /etc/os-release ]; then
    . /etc/os-release
    echo "[INFO] OS Name:       $NAME"
    echo "[INFO] Version:       $VERSION"
    echo "[INFO] ID:            $ID"
    echo "[INFO] Codename:      ${VERSION_CODENAME:-unknown}"
else
    echo "[ERROR] Cannot detect /etc/os-release"
    exit 1
fi

# Architecture Validation for Raspberry Pi 3B+ (armv7l or aarch64)
case "$ARCH" in
    armv7l|armv6l)
        echo "[OK] 32-bit ARM detected ($ARCH). Compatible with Debian ARMHF & HP HPLIP drivers."
        ;;
    aarch64|arm64)
        echo "[OK] 64-bit ARM detected ($ARCH). Compatible with Debian ARM64 packages."
        ;;
    x86_64)
        echo "[WARN] x86_64 environment detected (Development/Testing Host)."
        ;;
    *)
        echo "[WARN] Unknown architecture ($ARCH). Proceed with caution."
        ;;
esac

# Check for Raspberry Pi model in Device Tree
if [ -f /proc/device-tree/model ]; then
    PI_MODEL=$(tr -d '\0' < /proc/device-tree/model)
    echo "[OK] Hardware Model:  $PI_MODEL"
else
    echo "[INFO] Device Tree model not found (Running on non-Pi Linux or container)."
fi

# Memory & Swap check
MEM_TOTAL_MB=$(free -m | awk '/^Mem:/{print $2}')
SWAP_TOTAL_MB=$(free -m | awk '/^Swap:/{print $2}')
echo "[INFO] Total RAM:     ${MEM_TOTAL_MB} MB"
echo "[INFO] Total Swap:    ${SWAP_TOTAL_MB} MB"

if [ "$MEM_TOTAL_MB" -lt 800 ]; then
    echo "[WARN] RAM is under 1 GB. Ensure browser kiosk GPU acceleration and memory cgroups are tuned."
fi

echo "=========================================================="
echo "[SUCCESS] Operating system and architecture detection complete."
echo "=========================================================="
