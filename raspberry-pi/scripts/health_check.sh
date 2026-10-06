#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - SYSTEM HEALTH CHECK DIAGNOSTIC TOOL
# Tests Internet, Backend, Database, USB Printer, CUPS, and Temp File Security
# ==============================================================================

CONFIG_FILE="/etc/smartprint/agent_config.json"
BACKEND_URL="http://localhost:3000"
KIOSK_ID="GITAM-SPK-001"
QUEUE_NAME="HP_LaserJet_USB"

if [ -f "$CONFIG_FILE" ]; then
  BACKEND_URL=$(grep -o '"backend_url": *"[^"]*"' "$CONFIG_FILE" | cut -d'"' -f4 || echo "http://localhost:3000")
  KIOSK_ID=$(grep -o '"kiosk_id": *"[^"]*"' "$CONFIG_FILE" | cut -d'"' -f4 || echo "GITAM-SPK-001")
fi

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass_count=0
fail_count=0
warn_count=0

print_result() {
  local test_name="$1"
  local status="$2"
  local details="$3"

  if [ "$status" == "PASS" ]; then
    echo -e "  [ ${GREEN}PASS${NC} ] $test_name: $details"
    ((pass_count++))
  elif [ "$status" == "WARN" ]; then
    echo -e "  [ ${YELLOW}WARN${NC} ] $test_name: $details"
    ((warn_count++))
  else
    echo -e "  [ ${RED}FAIL${NC} ] $test_name: $details"
    ((fail_count++))
  fi
}

echo "=================================================="
echo "    GITAM SMARTPRINT - HARDWARE & SYSTEM HEALTH  "
echo "    Kiosk ID: $KIOSK_ID                          "
echo "=================================================="

# 1. Internet Check
if ping -c 1 -W 3 8.8.8.8 >/dev/null 2>&1; then
  print_result "Internet Connectivity" "PASS" "Public DNS reachable (8.8.8.8)"
else
  print_result "Internet Connectivity" "FAIL" "Cannot ping public gateway"
fi

# 2. Cloud Backend API Check
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/health" 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" == "200" ]; then
  print_result "Cloud Backend API" "PASS" "Connected to $BACKEND_URL (HTTP 200)"
elif [ "$HTTP_STATUS" == "000" ]; then
  print_result "Cloud Backend API" "FAIL" "Unreachable at $BACKEND_URL"
else
  print_result "Cloud Backend API" "WARN" "Received HTTP $HTTP_STATUS from $BACKEND_URL"
fi

# 3. USB HP Printer Hardware Check
if lsusb | grep -qi "Hewlett-Packard\|HP"; then
  USB_DEV=$(lsusb | grep -i "Hewlett-Packard\|HP" | head -n 1)
  print_result "USB HP Printer Detection" "PASS" "$USB_DEV"
else
  print_result "USB HP Printer Detection" "FAIL" "No HP device detected on USB bus"
fi

# 4. CUPS Daemon
if systemctl is-active --quiet cups; then
  print_result "CUPS Printing Daemon" "PASS" "cups.service active and running"
else
  print_result "CUPS Printing Daemon" "FAIL" "cups.service is stopped or failed"
fi

# 5. CUPS Queue Status
if command -v lpstat >/dev/null 2>&1; then
  if lpstat -p "$QUEUE_NAME" >/dev/null 2>&1; then
    Q_STATUS=$(lpstat -p "$QUEUE_NAME" | head -n 1)
    print_result "Printer Queue ($QUEUE_NAME)" "PASS" "$Q_STATUS"
  else
    print_result "Printer Queue ($QUEUE_NAME)" "WARN" "Queue not found. Run printer_setup.sh"
  fi
else
  print_result "CUPS Utilities (lpstat)" "FAIL" "lpstat command not found"
fi

# 6. Disk Storage Space
DISK_AVAIL_MB=$(df -m /var/lib | awk 'NR==2 {print $4}')
if [ "$DISK_AVAIL_MB" -gt 1000 ]; then
  print_result "Disk Storage (/var/lib)" "PASS" "${DISK_AVAIL_MB} MB available"
elif [ "$DISK_AVAIL_MB" -gt 200 ]; then
  print_result "Disk Storage (/var/lib)" "WARN" "Low storage: only ${DISK_AVAIL_MB} MB available"
else
  print_result "Disk Storage (/var/lib)" "FAIL" "CRITICAL: storage depleted (${DISK_AVAIL_MB} MB)"
fi

# 7. Temp Directory Security Permissions
if [ -d "/var/lib/smartprint/jobs" ]; then
  PERMS=$(stat -c "%a" /var/lib/smartprint/jobs 2>/dev/null || echo "000")
  if [ "$PERMS" == "700" ]; then
    print_result "Document Security Permissions" "PASS" "/var/lib/smartprint/jobs is chmod 700"
  else
    print_result "Document Security Permissions" "WARN" "Permissions are $PERMS (Expected: 700)"
  fi
else
  print_result "Document Security Directory" "WARN" "/var/lib/smartprint/jobs does not exist yet"
fi

# 8. Time Synchronization
if timedatectl 2>/dev/null | grep -qi "synchronized: yes"; then
  print_result "NTP Time Sync" "PASS" "System clock synchronized"
else
  print_result "NTP Time Sync" "WARN" "NTP time synchronization not confirmed"
fi

echo "=================================================="
echo "Health Check Summary: $pass_count PASS | $warn_count WARN | $fail_count FAIL"
if [ "$fail_count" -eq 0 ]; then
  echo -e "${GREEN}SYSTEM OPERATIONAL - KIOSK READY${NC}"
  exit 0
else
  echo -e "${RED}SYSTEM ISSUES DETECTED - REVIEW FAILURES ABOVE${NC}"
  exit 1
fi
