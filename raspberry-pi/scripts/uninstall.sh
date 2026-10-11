#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - UNINSTALL SCRIPT
# Removes systemd services, agent files, and temp directories.
# Preserves /etc/smartprint/agent_config.json unless --full is passed.
# Run: sudo bash uninstall.sh [--full]
# ==============================================================================

set -o pipefail

FULL_UNINSTALL=false
[ "$1" = "--full" ] && FULL_UNINSTALL=true

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'

log()  { echo -e "[$(date '+%H:%M:%S')] $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC}   $*"; }

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo bash uninstall.sh"
  exit 1
fi

echo -e "${RED}=============================================="
echo    "  GITAM SMARTPRINT UNINSTALL"
echo -e "==============================================  ${NC}"
echo ""
if [ "$FULL_UNINSTALL" = true ]; then
  warn "FULL uninstall — config and logs will also be removed."
else
  log "Standard uninstall — config at /etc/smartprint preserved. Use --full to remove everything."
fi
echo ""
read -r -p "Continue with uninstall? (type YES to confirm): " CONFIRM
[ "$CONFIRM" != "YES" ] && { echo "Aborted."; exit 0; }

# --- 1. Stop and disable services ---
log "[1/5] Stopping and disabling services..."
UNITS=(
  "smartprint-agent.service"
  "smartprint-kiosk.service"
  "smartprint-health.service"
  "smartprint-health.timer"
  "smartprint-cleanup.service"
  "smartprint-cleanup.timer"
)
for unit in "${UNITS[@]}"; do
  systemctl stop "$unit" 2>/dev/null && ok "  Stopped: $unit" || true
  systemctl disable "$unit" 2>/dev/null && ok "  Disabled: $unit" || true
done

# --- 2. Remove systemd unit files ---
log "[2/5] Removing systemd unit files..."
for unit in "${UNITS[@]}"; do
  if [ -f "/etc/systemd/system/$unit" ]; then
    rm -f "/etc/systemd/system/$unit"
    ok "  Removed: /etc/systemd/system/$unit"
  fi
done
systemctl daemon-reload

# --- 3. Kill any running Chromium kiosk ---
log "[3/5] Killing kiosk Chromium processes..."
for bin in chromium-browser chromium google-chrome; do
  killall -9 "$bin" 2>/dev/null && ok "  Killed: $bin" || true
done

# --- 4. Remove agent and job data ---
log "[4/5] Removing temp job files and agent state..."

# Secure-wipe all temp job files
if [ -d /var/lib/smartprint/jobs ]; then
  log "Secure-wiping customer document files in /var/lib/smartprint/jobs..."
  find /var/lib/smartprint/jobs -type f -exec shred -u -n 1 {} \; 2>/dev/null || \
    find /var/lib/smartprint/jobs -type f -exec rm -f {} \; 2>/dev/null || true
  ok "  Job temp files wiped."
fi

rm -f /var/lib/smartprint/agent_state.db && ok "  Removed: agent_state.db" || true

if [ "$FULL_UNINSTALL" = true ]; then
  rm -rf /var/lib/smartprint  && ok "  Removed: /var/lib/smartprint"
  rm -rf /etc/smartprint      && ok "  Removed: /etc/smartprint"
  rm -rf /var/log/smartprint  && ok "  Removed: /var/log/smartprint"
  rm -rf /opt/smartprint      && ok "  Removed: /opt/smartprint"
else
  warn "  Config /etc/smartprint preserved. Use --full to remove."
  warn "  Logs /var/log/smartprint preserved. Use --full to remove."
fi

# --- 5. Done ---
log "[5/5] Cleanup complete."
echo ""
echo -e "${GREEN}✓ GITAM SMARTPRINT uninstalled.${NC}"
[ "$FULL_UNINSTALL" = false ] && echo "  Run with --full to also remove config and logs."
