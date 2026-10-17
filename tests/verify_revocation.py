#!/usr/bin/env python3
"""
Verify that the revoked/exposed default device credentials are now strictly rejected with HTTP 403.
"""
import urllib.request
import urllib.error
import json
import os

EXPOSED_TOKEN = "gitam_spk_001_secure_device_secret_2026"

def test_revoked_token(base_url):
    print(f"\n[REVOCATION CHECK] Testing against: {base_url}")
    req = urllib.request.Request(
        f"{base_url}/api/kiosk/heartbeat",
        data=json.dumps({"ip_address": "192.168.1.105"}).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Kiosk-Id": "GITAM-SPK-001",
            "X-Device-Token": EXPOSED_TOKEN,
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print(f"  [CRITICAL FAILURE] Revoked token was ACCEPTED with status {resp.status}!")
            return False
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        print(f"  [SUCCESS] Revoked token correctly REJECTED with HTTP {e.code}: {body}")
        return e.code == 403
    except Exception as e:
        print(f"  [ERROR] Network error: {e}")
        return False

if __name__ == "__main__":
    test_revoked_token("http://localhost:3000")
    test_revoked_token("https://smart-prints.vercel.app")
