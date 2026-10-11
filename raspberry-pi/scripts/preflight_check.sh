#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - PREFLIGHT SYSTEM REQUIREMENTS CHECK (v2)
# Validates all hardware, software, and service pre-conditions BEFORE installation.
# Run: bash preflight_check.sh
# ==============================================================================

set -o pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PASS=0
WARN=0
FAIL=0

pass()  { echo -e "  ${GREEN}[PASS]${NC} $*"; ((PASS++)); }
warn()  { echo -e "  ${YELLOW}[WARN]${NC} $*"; ((WARN++)); }
fail()  { echo -e "  ${RED}[FAIL]${NC} $*"; ((FAIL++)); }
info()  { echo -e "  ${BLUE}[INFO]${NC} $*"; }
header(){ echo -e "\n${BLUE}=== $* ===${NC}"; }

header "GITAM SMARTPRINT - PREFLIGHT CHECK"
info "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"
info "Running as: $(whoami) (UID=$(id -u))"

# --- 1. OPERATING SYSTEM ---
header "Operating System"
if [ -f /etc/os-release ]; then
  source /etc/os-release
  info "OS: $PRETTY_NAME"
  if echo "$ID_LIKE $ID" | grep -qi "debian\|raspbian\|ubuntu"; then
    pass "Debian/Raspbian-based OS detected. Compatible."
  else
    warn "Non-Debian OS ($ID). Scripts designed for Raspberry Pi OS. Proceed with caution."
  fi
else
  fail "Cannot detect OS (/etc/os-release missing)"
fi

# --- 2. ARCHITECTURE ---
header "Hardware Architecture"
ARCH=$(uname -m)
info "Architecture: $ARCH"
if [[ "$ARCH" == "armv7l" || "$ARCH" == "aarch64" ]]; then
  pass "ARM architecture ($ARCH). Raspberry Pi compatible."
elif [[ "$ARCH" == "x86_64" ]]; then
  warn "x86_64 architecture detected. Running on PC, not Raspberry Pi. Some printer drivers may differ."
else
  fail "Unknown architecture: $ARCH"
fi

# Pi model detection
if [ -f /proc/cpuinfo ]; then
  PI_MODEL=$(grep -m1 "Model" /proc/cpuinfo | cut -d: -f2 | xargs || echo "Unknown")
  info "Pi Model: $PI_MODEL"
fi

# --- 3. SYSTEM RESOURCES ---
header "System Resources"
RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}' 2>/dev/null || echo 0)
RAM_MB=$((RAM_KB / 1024))
if [ "$RAM_MB" -ge 900 ]; then
  pass "RAM: ${RAM_MB} MB (minimum 900 MB required for Pi 3B+)"
else
  fail "RAM: ${RAM_MB} MB — insufficient. Minimum 900 MB required."
fi

DISK_AVAIL=$(df / --output=avail -m 2>/dev/null | tail -1 | xargs || echo 0)
if [ "$DISK_AVAIL" -ge 2048 ]; then
  pass "Free disk: ${DISK_AVAIL} MB (minimum 2 GB recommended)"
elif [ "$DISK_AVAIL" -ge 512 ]; then
  warn "Free disk: ${DISK_AVAIL} MB — low. Recommend 2 GB free minimum."
else
  fail "Free disk: ${DISK_AVAIL} MB — critically low. Cannot proceed safely."
fi

# CPU Temp
if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
  TEMP_RAW=$(cat /sys/class/thermal/thermal_zone0/temp)
  TEMP_C=$((TEMP_RAW / 1000))
  if [ "$TEMP_C" -lt 80 ]; then
    pass "CPU temperature: ${TEMP_C}°C (safe)"
  else
    warn "CPU temperature: ${TEMP_C}°C — high. Check cooling."
  fi
fi

# --- 4. NETWORK ---
header "Network Connectivity"
if ping -c 1 -W 3 8.8.8.8 &>/dev/null; then
  pass "Internet connectivity: reachable (8.8.8.8 responded)"
else
  fail "Internet not reachable. Required for cloud backend and package download."
fi

if command -v curl &>/dev/null; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 https://supabase.com 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "301" || "$HTTP_CODE" == "302" ]]; then
    pass "HTTPS to supabase.com: OK (HTTP $HTTP_CODE)"
  else
    warn "HTTPS to supabase.com: HTTP $HTTP_CODE — may be transient or firewall issue"
  fi
fi

# --- 5. ROOT ACCESS ---
header "Permissions"
if [ "$EUID" -eq 0 ]; then
  pass "Running as root. Required for installation."
else
  warn "Not running as root. Some checks may be limited. Run install.sh with sudo."
fi

# --- 6. PACKAGE MANAGER ---
header "Package Manager"
if command -v apt-get &>/dev/null; then
  pass "apt-get available."
  # Check if apt can fetch packages
  apt-get update -qq 2>/dev/null && pass "apt-get update: successful" || warn "apt-get update failed — check network or sources"
else
  fail "apt-get not available. Required for package installation."
fi

# --- 7. REQUIRED PACKAGES ---
header "Required Packages"
for pkg in python3 cups lpadmin lpinfo lpstat lp curl jq; do
  if command -v "$pkg" &>/dev/null; then
    pass "$pkg: installed"
  else
    warn "$pkg: NOT FOUND — will be installed during setup"
  fi
done

# Chromium browser
CHROMIUM_FOUND=false
for cb in chromium-browser chromium google-chrome-stable; do
  if command -v "$cb" &>/dev/null; then
    pass "Browser: $cb ($(${cb} --version 2>/dev/null | head -1 || echo 'version unknown'))"
    CHROMIUM_FOUND=true
    break
  fi
done
[ "$CHROMIUM_FOUND" = false ] && warn "No Chromium/Chrome found — will be installed by install.sh"

# Python3 pycups
if python3 -c "import cups" 2>/dev/null; then
  pass "pycups (Python3 CUPS binding): installed"
else
  warn "pycups: NOT installed — will be installed. Fallback to lp/lpstat CLI available."
fi

# pdf-lib equivalent (for Pi side, not needed)
if python3 -c "import requests" 2>/dev/null; then
  pass "requests (Python3): installed"
else
  warn "requests (Python3): NOT installed — will be installed by setup"
fi

# --- 8. CUPS SERVICE ---
header "CUPS Print System"
if systemctl is-active cups &>/dev/null; then
  pass "CUPS service: running"
  CUPS_QUEUES=$(lpstat -a 2>/dev/null | wc -l || echo 0)
  info "CUPS queues configured: $CUPS_QUEUES"
elif systemctl is-enabled cups &>/dev/null; then
  warn "CUPS: enabled but not running — will be started by installer"
else
  warn "CUPS: not installed — will be installed by install.sh"
fi

# --- 9. USB PRINTER DETECTION ---
header "USB Printer Hardware"
if command -v lsusb &>/dev/null; then
  USB_PRINTERS=$(lsusb 2>/dev/null | grep -i "HP\|Canon\|Hewlett\|Epson\|Brother\|Printer" || true)
  if [ -n "$USB_PRINTERS" ]; then
    pass "USB printer device(s) detected:"
    echo "$USB_PRINTERS" | while read -r line; do info "  $line"; done
  else
    warn "No USB printer detected on USB bus. Connect printer before running printer_setup.sh"
  fi
else
  warn "lsusb not available (usbutils not installed)"
fi

if command -v lpinfo &>/dev/null; then
  LPINFO_USB=$(lpinfo -v 2>/dev/null | grep -i "usb://" || true)
  if [ -n "$LPINFO_USB" ]; then
    pass "CUPS detects USB printer URI(s):"
    echo "$LPINFO_USB" | while read -r line; do info "  $line"; done
  else
    warn "CUPS lpinfo: no USB printer URI — connect printer first"
  fi
fi

# --- 10. DISPLAY ENVIRONMENT ---
header "Display Environment"
if [ -n "$DISPLAY" ]; then
  pass "DISPLAY variable: $DISPLAY"
elif [ -d /tmp/.X11-unix ]; then
  info "X11 socket found at /tmp/.X11-unix — DISPLAY may be set in user session"
  warn "DISPLAY env var not set in this shell. Run kiosk_setup.sh from X11 session."
else
  warn "No X11 display found. Ensure a graphical session is running (sudo raspi-config → Desktop autologin)"
fi

if command -v unclutter &>/dev/null; then
  pass "unclutter (cursor hider): installed"
else
  warn "unclutter: NOT installed — cursor may remain visible"
fi

# --- 11. DIRECTORIES ---
header "SmartPrint Directories"
for dir in /etc/smartprint /var/lib/smartprint /var/lib/smartprint/jobs /var/log/smartprint /opt/smartprint; do
  if [ -d "$dir" ]; then
    pass "$dir: exists"
  else
    info "$dir: will be created by install.sh"
  fi
done

# --- 12. EXISTING SERVICES ---
header "Existing SmartPrint Services"
for svc in smartprint-agent smartprint-kiosk smartprint-health smartprint-cleanup; do
  if systemctl list-unit-files "$svc.service" 2>/dev/null | grep -q "$svc"; then
    STATUS=$(systemctl is-active "$svc.service" 2>/dev/null || echo "inactive")
    pass "$svc.service: registered (status: $STATUS)"
  else
    info "$svc.service: not yet installed"
  fi
done

# --- SUMMARY ---
echo ""
echo "=============================================="
echo "  PREFLIGHT CHECK SUMMARY"
echo "  PASS: $PASS  |  WARN: $WARN  |  FAIL: $FAIL"
echo "=============================================="

if [ "$FAIL" -eq 0 ]; then
  if [ "$WARN" -eq 0 ]; then
    echo -e "${GREEN}✓ ALL CHECKS PASSED — System ready for installation.${NC}"
  else
    echo -e "${YELLOW}⚠ PASSED WITH WARNINGS — Review warnings before proceeding.${NC}"
    echo "  Most warnings (missing packages, printer) will be resolved by install.sh."
  fi
  exit 0
else
  echo -e "${RED}✗ $FAIL CRITICAL FAILURE(S) — Resolve before running install.sh.${NC}"
  exit 1
fi
