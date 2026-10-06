#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - HDMI KIOSK DISPLAY LAUNCHER
# Runs Chromium in clean, fullscreen Kiosk Mode on HDMI output
# ==============================================================================

KIOSK_URL=${1:-"http://localhost:3000/kiosk/GITAM-SPK-001"}

echo "Starting GITAM SMARTPRINT HDMI Kiosk Display..."
echo "Target URL: $KIOSK_URL"

# Disable screen blanking & power management
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true

# Hide mouse cursor when idle
unclutter -idle 0.5 -root &

# Kill any existing chromium instances
killall -9 chromium-browser 2>/dev/null || true
killall -9 chromium 2>/dev/null || true

# Clear cached crash / session restore dialogs
rm -rf ~/.config/chromium/Default/Preferences 2>/dev/null || true
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' ~/.config/chromium/Default/Preferences 2>/dev/null || true
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' ~/.config/chromium/Default/Preferences 2>/dev/null || true

# Launch Chromium in pure fullscreen kiosk mode
exec chromium-browser \
  --noerrdialogs \
  --disable-infobars \
  --kiosk \
  --incognito \
  --disable-translate \
  --no-first-run \
  --fast \
  --fast-start \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 \
  "$KIOSK_URL"
