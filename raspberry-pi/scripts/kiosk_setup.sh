#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - RASPBERRY PI FULLSCREEN KIOSK LAUNCHER (v3.0)
# Manages Chromium in hardened fullscreen kiosk mode on 800x480 DSI display.
# Preserves touch input, prevents keyring dialogs, and recovers cleanly from crashes.
# ==============================================================================

set -o pipefail

KIOSK_URL="${KIOSK_URL:-"https://smart-prints.vercel.app/kiosk/GITAM-SPK-001"}"
LOG_FILE="/var/log/smartprint/kiosk.log"
CHROME_DIR="${HOME}/.config/chromium"
PREFS_FILE="${CHROME_DIR}/Default/Preferences"

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] KIOSK: $*" | tee -a "$LOG_FILE" 2>/dev/null || echo "[KIOSK] $*"
}

log "=================================================="
log "GITAM SMARTPRINT FULLSCREEN KIOSK INITIALIZING"
log "Target Kiosk URL: $KIOSK_URL"
log "Display: ${DISPLAY:-:0} | Wayland: ${WAYLAND_DISPLAY:-none}"
log "=================================================="

# --- 1. Display Power Management & Screensaver Suppression ---
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true
xset s 0 0 2>/dev/null || true

# --- 2. Hide mouse cursor when idle on touchscreen ---
if command -v unclutter &>/dev/null; then
  killall unclutter 2>/dev/null || true
  unclutter -idle 0.5 -root &
  log "Touchscreen cursor auto-hiding enabled via unclutter."
fi

# --- 3. Detect Chromium Binary ---
CHROMIUM_BIN=""
for candidate in chromium-browser chromium google-chrome-stable google-chrome; do
  if command -v "$candidate" &>/dev/null; then
    CHROMIUM_BIN="$candidate"
    break
  fi
done

if [ -z "$CHROMIUM_BIN" ]; then
  log "ERROR: Chromium binary not found. Install with: sudo apt-get install -y chromium-browser"
  exit 1
fi
log "Using browser binary: $CHROMIUM_BIN"

# --- 4. Crash Recovery & Stale Lock Sanitization ---
# Remove stale singleton lock files that prevent Chromium from starting after unexpected power loss
rm -f "${CHROME_DIR}/SingletonLock" 2>/dev/null || true
rm -f "${CHROME_DIR}/SingletonSocket" 2>/dev/null || true
rm -f "${CHROME_DIR}/SingletonCookie" 2>/dev/null || true
rm -f "${CHROME_DIR}/Default/SingletonLock" 2>/dev/null || true

# Mark previous session as cleanly exited to suppress 'Restore pages' banner
if [ -f "$PREFS_FILE" ]; then
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/g' "$PREFS_FILE" 2>/dev/null || true
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/g' "$PREFS_FILE" 2>/dev/null || true
fi

# Prevent duplicate browser processes
killall -9 "$CHROMIUM_BIN" 2>/dev/null || true
sleep 1

# --- 5. Launch Hardened Fullscreen Chromium Kiosk ---
log "Launching fullscreen kiosk browser for 800x480 DSI display..."

exec "$CHROMIUM_BIN" \
  --kiosk \
  --window-size=800,480 \
  --window-position=0,0 \
  --touch-events=enabled \
  --password-store=basic \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --no-first-run \
  --no-default-browser-check \
  --disable-translate \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 \
  --disable-background-networking \
  --disable-sync \
  --disable-default-apps \
  --disable-extensions \
  --disable-component-extensions-with-background-pages \
  --disable-dev-shm-usage \
  --no-sandbox \
  --incognito \
  --autoplay-policy=no-user-gesture-required \
  "$KIOSK_URL" 2>>"$LOG_FILE"
