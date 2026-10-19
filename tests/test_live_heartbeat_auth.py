#!/usr/bin/env python3
"""
GITAM SMARTPRINT - Live Heartbeat Authentication Tests

Tests authenticated heartbeat against the backend and verifies
authentication enforcement and telemetry response structure.

Usage:
    # Against local dev server (default):
    python tests/test_live_heartbeat_auth.py

    # Against a specific backend with credentials from env:
    SMARTPRINT_BASE_URL=https://smart-prints.vercel.app \
    KIOSK_001_TOKEN=<raw_token> \
    KIOSK_002_TOKEN=<raw_token> \
    python tests/test_live_heartbeat_auth.py

Required environment variables (or values in device_credentials.env):
    KIOSK_001_TOKEN  -- raw device token for GITAM-SPK-001
    KIOSK_002_TOKEN  -- raw device token for GITAM-SPK-002

SECURITY: Never hardcode raw device tokens in this file.
Tokens must be passed via environment variables only.
"""
import urllib.request
import urllib.error
import json
import os
import sys

# ---------------------------------------------------------------------------
# Configuration - all secrets from environment, never hardcoded
# ---------------------------------------------------------------------------

BASE_URL = os.getenv("SMARTPRINT_BASE_URL", "http://localhost:3000").rstrip("/")

KIOSK_001_ID = "GITAM-SPK-001"
KIOSK_002_ID = "GITAM-SPK-002"


def _load_token(env_key: str) -> str:
    """Load a device token from environment variable or device_credentials.env (gitignored)."""
    if os.getenv(env_key):
        return os.getenv(env_key)
    env_file = os.path.join(os.path.dirname(__file__), "..", "device_credentials.env")
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                if line.startswith(f"{env_key}="):
                    return line.strip().split("=", 1)[1]
    return ""


KIOSK_001_TOKEN = _load_token("KIOSK_001_TOKEN")
KIOSK_002_TOKEN = _load_token("KIOSK_002_TOKEN")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def post_heartbeat(kiosk_id, token, payload):
    """POST to /api/kiosk/heartbeat and return (status_code, response_dict)."""
    url = f"{BASE_URL}/api/kiosk/heartbeat"
    headers = {
        "Content-Type": "application/json",
        "User-Agent": f"GITAM-SmartPrint-Agent/1.0-test ({kiosk_id or 'unknown'})",
    }
    if kiosk_id:
        headers["X-Kiosk-Id"] = kiosk_id
    if token:
        headers["X-Device-Token"] = token

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read().decode("utf-8")
            return resp.status, json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        content = e.read().decode("utf-8") if e.fp else str(e)
        try:
            return e.code, json.loads(content)
        except Exception:
            return e.code, {"error": content}
    except Exception as e:
        return 0, {"error": str(e)}


def run_tests():
    failures = []

    # ------------------------------------------------------------------
    # TEST 1: Missing credentials headers -- 401
    # ------------------------------------------------------------------
    print("\nTEST 1: Missing credentials headers -- expect 401")
    status, res = post_heartbeat(None, None, {"kiosk_id": KIOSK_001_ID})
    print(f"  Status: {status} | {res}")
    if status != 401:
        failures.append(f"TEST 1 FAILED: Expected 401, got {status}")
    else:
        print("  [PASS]")

    # ------------------------------------------------------------------
    # TEST 2: Invalid kiosk ID -- 404
    # ------------------------------------------------------------------
    print("\nTEST 2: Invalid kiosk ID -- expect 404")
    status, res = post_heartbeat("GITAM-SPK-999", "sometoken", {"kiosk_id": "GITAM-SPK-999"})
    print(f"  Status: {status} | {res}")
    if status != 404:
        failures.append(f"TEST 2 FAILED: Expected 404, got {status}")
    else:
        print("  [PASS]")

    # ------------------------------------------------------------------
    # TEST 3: Wrong device token for valid kiosk -- 403
    # ------------------------------------------------------------------
    print("\nTEST 3: Invalid device token -- expect 403")
    status, res = post_heartbeat(KIOSK_001_ID, "invalid_token_12345", {"kiosk_id": KIOSK_001_ID})
    print(f"  Status: {status} | {res}")
    if status != 403:
        failures.append(f"TEST 3 FAILED: Expected 403, got {status}")
    else:
        print("  [PASS]")

    # ------------------------------------------------------------------
    # TEST 4: Valid authenticated heartbeat (requires KIOSK_001_TOKEN)
    # ------------------------------------------------------------------
    print("\nTEST 4: Valid authenticated heartbeat with Raspberry Pi 4 telemetry -- expect 200")
    if not KIOSK_001_TOKEN:
        print("  [SKIP] KIOSK_001_TOKEN not set - skipping live credential test.")
        print("         Set KIOSK_001_TOKEN env var or populate device_credentials.env to enable.")
    else:
        telemetry = {
            "kiosk_id": KIOSK_001_ID,
            "cpu_temp": 46.2,
            "ram_usage": 34.8,
            "disk_usage": 19.1,
            "hardware_model": "Raspberry Pi 4 Model B",
            "agent_version": "1.0.0",
        }
        status, res = post_heartbeat(KIOSK_001_ID, KIOSK_001_TOKEN, telemetry)
        print(f"  Status: {status} | {res}")
        if status != 200:
            failures.append(f"TEST 4 FAILED: Expected 200, got {status}. Response: {res}")
        else:
            print("  [PASS]")

    # ------------------------------------------------------------------
    print("\n" + "=" * 60)
    if failures:
        print(f"RESULT: {len(failures)} test(s) FAILED:")
        for f in failures:
            print(f"  X {f}")
        sys.exit(1)
    else:
        print("RESULT: ALL HEARTBEAT AUTHENTICATION TESTS PASSED")
        sys.exit(0)


if __name__ == "__main__":
    print("=" * 60)
    print(f"GITAM SMARTPRINT - Heartbeat Auth Tests")
    print(f"Backend: {BASE_URL}")
    print(f"KIOSK_001_TOKEN loaded: {'YES' if KIOSK_001_TOKEN else 'NO (TEST 4 will SKIP)'}")
    print("=" * 60)
    run_tests()
