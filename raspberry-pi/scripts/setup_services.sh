#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - SERVICE INSTALLATION SCRIPT (v2)
# Installs all systemd units, enables timers, and sets up agent config.
# Run: sudo bash setup_services.sh
# ==============================================================================

set -e
set -o pipefail

INSTALL_DIR="/opt/smartprint"
SYSTEMD_DIR="/etc/systemd/system"
LOG_FILE="/var/log/smartprint/setup_services.log"

mkdir -p /var/log/smartprint 2>/dev/null || true

log()  { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
warn() { echo "  [WARN] $*" | tee -a "$LOG_FILE"; }
fail() { echo "  [FAIL] $*" | tee -a "$LOG_FILE"; exit 1; }

if [ "$EUID" -ne 0 ]; then
  fail "Please run as root: sudo bash setup_services.sh"
fi

log "=============================================="
log "GITAM SMARTPRINT - SERVICE SETUP"
log "=============================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

# --- 1. Copy project to /opt/smartprint ---
log "[1/5] Copying SmartPrint project to $INSTALL_DIR..."
if [ "$PARENT_DIR" != "$INSTALL_DIR" ]; then
  mkdir -p "$INSTALL_DIR"
  cp -r "$PARENT_DIR"/* "$INSTALL_DIR/" 2>/dev/null || warn "Some files could not be copied (check permissions)"
  log "Project copied to $INSTALL_DIR"
else
  log "Already in $INSTALL_DIR — skipping copy."
fi

chmod +x "$INSTALL_DIR/raspberry-pi/scripts/"*.sh 2>/dev/null || true
chmod +x "$INSTALL_DIR/raspberry-pi/agent/"*.py 2>/dev/null || true

# --- 2. Install systemd units ---
log "[2/5] Installing systemd service units..."
SYSTEMD_SOURCE="$INSTALL_DIR/raspberry-pi/systemd"

UNITS=(
  "smartprint-agent.service"
  "smartprint-kiosk.service"
  "smartprint-health.service"
  "smartprint-health.timer"
  "smartprint-cleanup.service"
  "smartprint-cleanup.timer"
)

for unit in "${UNITS[@]}"; do
  if [ -f "$SYSTEMD_SOURCE/$unit" ]; then
    cp "$SYSTEMD_SOURCE/$unit" "$SYSTEMD_DIR/$unit"
    log "  Installed: $unit"
  else
    warn "  Missing: $SYSTEMD_SOURCE/$unit — skipping"
  fi
done

# --- 3. Reload systemd ---
log "[3/5] Reloading systemd daemon..."
systemctl daemon-reload

# --- 4. Enable services and timers ---
log "[4/5] Enabling services..."
systemctl enable smartprint-agent.service
log "  Enabled: smartprint-agent.service"

systemctl enable smartprint-cleanup.service smartprint-cleanup.timer
systemctl start smartprint-cleanup.timer
log "  Enabled + Started: smartprint-cleanup.timer"

systemctl enable smartprint-health.service smartprint-health.timer
systemctl start smartprint-health.timer
log "  Enabled + Started: smartprint-health.timer"

# NOTE: smartprint-kiosk.service requires graphical-session.target
# Enable it but remind the user it needs the desktop session
systemctl enable smartprint-kiosk.service
log "  Enabled: smartprint-kiosk.service (requires graphical session)"

# --- 5. Generate agent config if needed ---
log "[5/5] Checking agent configuration..."
CONFIG_FILE="/etc/smartprint/agent_config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  mkdir -p /etc/smartprint
  cat > "$CONFIG_FILE" <<'EOF'
{
  "backend_url": "http://localhost:3001",
  "kiosk_id": "GITAM-SPK-001",
  "device_token": "CHANGE_THIS_TO_YOUR_SECURE_DEVICE_TOKEN",
  "poll_interval_sec": 4,
  "heartbeat_interval_sec": 10,
  "cups_bw_queue": "smartprint_bw_01",
  "cups_color_queue": "smartprint_color_01",
  "log_level": "INFO"
}
EOF
  log "  Created default config: $CONFIG_FILE"
  warn "  UPDATE backend_url and device_token in $CONFIG_FILE before starting agent!"
else
  log "  Config exists: $CONFIG_FILE (not overwritten)"
fi

log "=============================================="
log "SERVICE SETUP COMPLETE"
log ""
log "To start SmartPrint Agent now:"
log "  sudo systemctl start smartprint-agent"
log ""
log "To start Kiosk Display (requires desktop session):"
log "  sudo systemctl start smartprint-kiosk"
log ""
log "To view logs:"
log "  journalctl -u smartprint-agent -f"
log "  journalctl -u smartprint-kiosk -f"
log "  cat /var/log/smartprint/kiosk.log"
log ""
log "Timer status:"
log "  systemctl list-timers"
log "=============================================="
