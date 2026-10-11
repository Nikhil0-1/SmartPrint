#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - RASPBERRY PI PYTHON AGENT SETUP
# Sets up virtual environment, installs minimal dependencies,
# compiles pycups where available, and verifies CUPS bindings.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
AGENT_DIR="${PI_DIR}/agent"
VENV_DIR="/opt/smartprint/venv"

echo "=========================================================="
echo "  GITAM SMARTPRINT — PYTHON AGENT ENVIRONMENT SETUP"
echo "=========================================================="

if [ "$EUID" -ne 0 ]; then
    echo "[ERROR] This script must be run as root (sudo)."
    exit 1
fi

echo "[INFO] Updating package indices and installing build prerequisites..."
apt-get update -y
apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    python3-dev \
    libcups2-dev \
    cups-client \
    curl \
    sqlite3

echo "[INFO] Creating isolated Python virtual environment at $VENV_DIR..."
mkdir -p /opt/smartprint
python3 -m venv "$VENV_DIR"

echo "[INFO] Upgrading pip and wheel inside virtual environment..."
"$VENV_DIR/bin/pip" install --upgrade pip setuptools wheel

echo "[INFO] Installing Python requirements from ${PI_DIR}/requirements.txt..."
if [ -f "${PI_DIR}/requirements.txt" ]; then
    "$VENV_DIR/bin/pip" install -r "${PI_DIR}/requirements.txt"
fi

# Attempt pycups installation
echo "[INFO] Verifying pycups driver interface..."
if "$VENV_DIR/bin/pip" install pycups; then
    echo "[OK] pycups compiled and installed successfully."
else
    echo "[WARN] Native pycups build failed; fallback to CUPS CLI lp/lpstat commands active."
fi

# Link agent files into /opt/smartprint/agent
mkdir -p /opt/smartprint/agent
cp -r "${AGENT_DIR}/"* /opt/smartprint/agent/
chmod +x /opt/smartprint/agent/*.py

echo "=========================================================="
echo "[SUCCESS] SmartPrint Agent environment setup completed."
echo "=========================================================="
