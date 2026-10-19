#!/usr/bin/env python3
"""
Test authenticated heartbeat against production backend and verify authentication and telemetry responses.
"""
import urllib.request
import urllib.error
import json

PROD_URL = "https://smart-prints.vercel.app"

KIOSK_001_ID = "GITAM-SPK-001"
KIOSK_001_TOKEN = "c3689c1739e68cf55b82a18063eeeb42012c23b9a08abda8f23e2d59d60ccaaa"

KIOSK_002_ID = "GITAM-SPK-002"
KIOSK_002_TOKEN = "91db53f449553901953c5d23644cf770ed725358ad17f3553932c6256f5bd233"

def post_heartbeat(kiosk_id, token, payload):
    url = f"{PROD_URL}/api/kiosk/heartbeat"
    headers = {
        "Content-Type": "application/json",
        "User-Agent": f"GITAM-SmartPrint-Agent/1.0 ({kiosk_id})"
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
            return resp.status, json.loads(content)
    except urllib.error.HTTPError as e:
        content = e.read().decode("utf-8") if e.fp else str(e)
        try:
            return e.code, json.loads(content)
        except Exception:
            return e.code, {"error": content}
    except Exception as e:
        return 0, {"error": str(e)}

if __name__ == "__main__":
    print("=" * 60)
    print("TEST 1: Missing credentials headers")
    status, res = post_heartbeat(None, None, {"kiosk_id": KIOSK_001_ID})
    print(f"Status: {status} | Response: {res}")
    assert status == 401, f"Expected 401, got {status}"

    print("\nTEST 2: Invalid kiosk ID")
    status, res = post_heartbeat("GITAM-SPK-999", KIOSK_001_TOKEN, {"kiosk_id": "GITAM-SPK-999"})
    print(f"Status: {status} | Response: {res}")
    assert status == 404, f"Expected 404, got {status}"

    print("\nTEST 3: Invalid device token")
    status, res = post_heartbeat(KIOSK_001_ID, "invalid_token_12345", {"kiosk_id": KIOSK_001_ID})
    print(f"Status: {status} | Response: {res}")
    assert status == 403, f"Expected 403, got {status}"

    print("\nTEST 4: Valid Authenticated Heartbeat for Kiosk 001 with Raspberry Pi 4 Model B telemetry")
    telemetry = {
        "kiosk_id": KIOSK_001_ID,
        "cpu_temp": 46.2,
        "ram_usage": 34.8,
        "disk_usage": 19.1,
        "hardware_model": "Raspberry Pi 4 Model B",
        "agent_version": "1.0.0"
    }
    status, res = post_heartbeat(KIOSK_001_ID, KIOSK_001_TOKEN, telemetry)
    print(f"Status: {status} | Response: {res}")
    assert status == 200, f"Expected 200, got {status}"

    print("\nALL HEARTBEAT AUTHENTICATION TESTS PASSED!")
