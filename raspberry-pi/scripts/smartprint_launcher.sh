#!/usr/bin/env bash
# ==============================================================================
# GITAM SMARTPRINT - PRODUCTION AGENT BOOT LAUNCHER
# Automatically finds repository, syncs latest code from Git on boot if online,
# ensures CUPS/Pantum queue is ready, and launches Python agent daemon.
# ==============================================================================

set -o pipefail

# 1. Locate repository directory
REPO_DIR=""
POSSIBLE_DIRS=(
  "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  "/home/pi/SmartPrint"
  "/home/pi/Desktop/SmartPrint"
  "/home/smartprint/SmartPrint"
  "/opt/smartprint"
  "/root/SmartPrint"
)

for dir in "${POSSIBLE_DIRS[@]}"; do
  if [ -f "$dir/raspberry-pi/agent/smartprint_agent.py" ]; then
    REPO_DIR="$dir"
    break
  fi
done

if [ -z "$REPO_DIR" ]; then
  # Fallback search for smartprint_agent.py
  FOUND=$(find /home /root /opt -maxdepth 4 -name "smartprint_agent.py" 2>/dev/null | head -n 1)
  if [ -n "$FOUND" ]; then
    REPO_DIR="$(cd "$(dirname "$FOUND")/../.." && pwd)"
  fi
fi

if [ -z "$REPO_DIR" ]; then
  echo "[ERROR] Could not locate SmartPrint repository directory." >&2
  exit 1
fi

echo "[SmartPrint Launcher] Operating repository: $REPO_DIR"
cd "$REPO_DIR"

# Ensure log and state directories exist
mkdir -p /var/log/smartprint /var/lib/smartprint /etc/smartprint 2>/dev/null || true

# 2. Fast Network Wait (Up to 15 seconds)
echo "[SmartPrint Launcher] Waiting for network connection..."
for i in {1..15}; do
  if ping -c 1 8.8.8.8 >/dev/null 2>&1 || curl -s --connect-timeout 2 "https://smart-prints.vercel.app/api/health" >/dev/null 2>&1; then
    echo "[SmartPrint Launcher] Network online after ${i}s."
    break
  fi
  sleep 1
done

# 3. Auto-sync with GitHub main branch on boot (Zero cmd update required)
if [ -d "$REPO_DIR/.git" ]; then
  echo "[SmartPrint Launcher] Checking for remote updates on origin/main..."
  git -C "$REPO_DIR" fetch origin main --quiet 2>/dev/null || true
  LOCAL_HASH=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo "")
  REMOTE_HASH=$(git -C "$REPO_DIR" rev-parse origin/main 2>/dev/null || echo "")
  if [ -n "$REMOTE_HASH" ] && [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
    echo "[SmartPrint Launcher] Updating repository to latest commit ($REMOTE_HASH)..."
    git -C "$REPO_DIR" reset --hard origin/main --quiet 2>/dev/null || true
    echo "[SmartPrint Launcher] Auto-update complete."
  fi
fi

# 4. Launch Python Agent Daemon
echo "[SmartPrint Launcher] Starting Python SmartPrint Agent..."
exec /usr/bin/python3 "$REPO_DIR/raspberry-pi/agent/smartprint_agent.py"
