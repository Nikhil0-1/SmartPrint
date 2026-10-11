#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - HDMI KIOSK DISPLAY LAUNCHER (Production v2)
# Runs Chromium in fullscreen Kiosk Mode on HDMI-connected monitor (Raspberry Pi 3B+)
# This script is designed to be run inside an X11/Wayland session (graphical.target).
# Managed by smartprint-kiosk.service via systemd.
# ==============================================================================

set -o pipefail

KIOSK_URL="${KIOSK_URL:-${1:-"http://localhost:3000/kiosk/GITAM-SPK-001"}}"
LOG_FILE="/var/log/smartprint/kiosk.log"
CRASH_RESTORE_FILE="${HOME}/.config/chromium/Default/Preferences"

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] KIOSK: $*" | tee -a "$LOG_FILE" 2>/dev/null || echo "[KIOSK] $*"
}

log "=========================================="
log "GITAM SMARTPRINT KIOSK DISPLAY STARTING"
log "Target URL: $KIOSK_URL"
log "Display: ${DISPLAY:-:0}"
log "=========================================="

# --- 1. Disable screen blanking and DPMS power-off ---
xset s off          2>/dev/null || log "WARN: xset s off failed"
xset -dpms          2>/dev/null || log "WARN: xset -dpms failed"
xset s noblank      2>/dev/null || log "WARN: xset noblank failed"
xset s 0 0          2>/dev/null || true

# --- 2. Hide mouse cursor after 0.5s of idle ---
if command -v unclutter &>/dev/null; then
  killall unclutter 2>/dev/null || true
  unclutter -idle 0.5 -root &
  log "Cursor hiding via unclutter enabled."
fi

# --- 3. Detect Chromium binary name ---
CHROMIUM_BIN=""
for candidate in chromium-browser chromium google-chrome-stable google-chrome; do
  if command -v "$candidate" &>/dev/null; then
    CHROMIUM_BIN="$candidate"
    break
  fi
done

if [ -z "$CHROMIUM_BIN" ]; then
  log "ERROR: No Chromium/Chrome binary found. Install with: sudo apt-get install -y chromium-browser"
  exit 1
fi
log "Using browser: $CHROMIUM_BIN ($(${CHROMIUM_BIN} --version 2>/dev/null || echo 'version unknown'))"

# --- 4. Clear crash restore / session dialogs (prevents 'Chromium didn't shut down correctly' banner) ---
if [ -f "$CRASH_RESTORE_FILE" ]; then
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/g' "$CRASH_RESTORE_FILE" 2>/dev/null || true
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/g' "$CRASH_RESTORE_FILE" 2>/dev/null || true
fi
# Remove Single singleton lock (prevents "already running" on crash recovery)
rm -f "${HOME}/.config/chromium/SingletonLock" 2>/dev/null || true
rm -f "${HOME}/.config/chromium/Default/SingletonLock" 2>/dev/null || true

# --- 5. Kill any stale Chromium processes before starting fresh ---
killall -9 "$CHROMIUM_BIN" 2>/dev/null || true
sleep 1

# --- 6. Launch Chromium in full kiosk mode with Pi 3B+ optimizations ---
# --disable-gpu: Required on Raspberry Pi 3B+ to prevent GL errors and crashes
# --disable-dev-shm-usage: Prevents /dev/shm space issues on Pi
# --no-sandbox: Required when running as non-root in kiosk service context
# --disable-extensions: Reduces memory overhead
log "Launching $CHROMIUM_BIN in kiosk mode..."

exec "$CHROMIUM_BIN" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --no-first-run \
  --disable-translate \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 \
  --disable-background-networking \
  --disable-sync \
  --metrics-recording-only \
  --disable-default-apps \
  --disable-extensions \
  --disable-component-extensions-with-background-pages \
  --disable-gpu \
  --disable-dev-shm-usage \
  --no-sandbox \
  --disable-software-rasterizer \
  --ignore-certificate-errors \
  --disable-features=TranslateUI \
  --incognito \
  "$KIOSK_URL" 2>>"$LOG_FILE"
