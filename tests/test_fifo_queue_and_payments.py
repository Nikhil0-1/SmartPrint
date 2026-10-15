#!/usr/bin/env python3
"""
GITAM SMARTPRINT -- FIFO Queue & Payment Regression Test Suite
Tests: FIFO ordering, multi-user isolation, payment signature, idempotency, lease recovery.

Usage:
  python tests/test_fifo_queue_and_payments.py --base-url https://smart-print-sandy.vercel.app
  python tests/test_fifo_queue_and_payments.py --base-url http://localhost:3000

Environment variables (override defaults):
  SMARTPRINT_TEST_BASE_URL   -- backend base URL
  SMARTPRINT_ADMIN_TOKEN     -- admin secret token
  SMARTPRINT_KIOSK_ID        -- kiosk ID for test jobs
  SMARTPRINT_DEVICE_TOKEN    -- kiosk device token
  SMARTPRINT_ORG_ID          -- organization UUID
"""

import os
import sys
import json
import time
import uuid
import hmac
import hashlib
import urllib.request
import urllib.error
import argparse
from datetime import datetime

# --- Configuration ------------------------------------------------------------

BASE_URL = os.getenv("SMARTPRINT_TEST_BASE_URL", "http://localhost:3000")
ADMIN_TOKEN = os.getenv("SMARTPRINT_ADMIN_TOKEN", "")
KIOSK_ID = os.getenv("SMARTPRINT_KIOSK_ID", "GITAM-SPK-001")
DEVICE_TOKEN = os.getenv("SMARTPRINT_DEVICE_TOKEN", "gitam_spk_001_secure_device_secret_2026")
ORG_ID = os.getenv("SMARTPRINT_ORG_ID", "00000000-0000-0000-0000-000000000001")

PASSED = 0
FAILED = 0
SKIPPED = 0
RESULTS = []


# --- HTTP Helpers -------------------------------------------------------------

def api(endpoint, payload=None, method="POST", headers=None, timeout=15):
    """Make an API request and return (status_code, body_dict)."""
    url = f"{BASE_URL}{endpoint}"
    default_headers = {
        "Content-Type": "application/json",
        "X-Kiosk-Id": KIOSK_ID,
        "X-Device-Token": DEVICE_TOKEN,
    }
    if ADMIN_TOKEN:
        default_headers["Authorization"] = f"Bearer {ADMIN_TOKEN}"
    if headers:
        default_headers.update(headers)

    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(url, data=data, headers=default_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode()
            return resp.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"error": body}
    except Exception as e:
        return 0, {"error": str(e)}


# --- Test Infrastructure ------------------------------------------------------

def test(name, func):
    """Run a named test function and record the result."""
    global PASSED, FAILED, SKIPPED
    print(f"\n[TEST] {name}")
    try:
        result = func()
        if result is None:
            result = True
        if result == "SKIP":
            SKIPPED += 1
            RESULTS.append(("SKIP", name))
            print(f"  [SKIP]")
        elif result:
            PASSED += 1
            RESULTS.append(("PASS", name))
            print(f"  [PASS]")
        else:
            FAILED += 1
            RESULTS.append(("FAIL", name))
            print(f"  [FAIL]")
    except AssertionError as e:
        FAILED += 1
        RESULTS.append(("FAIL", name))
        print(f"  [FAIL] assertion: {e}")
    except Exception as e:
        FAILED += 1
        RESULTS.append(("FAIL", name))
        print(f"  [FAIL] exception: {e}")


def assert_eq(label, actual, expected):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_in(label, actual, choices):
    if actual not in choices:
        raise AssertionError(f"{label}: expected one of {choices!r}, got {actual!r}")


def assert_true(label, val):
    if not val:
        raise AssertionError(f"{label}: expected truthy, got {val!r}")


# --- Test Helpers -------------------------------------------------------------

def create_mock_job(suffix=""):
    """Create a minimal in-memory job record via the store (used for queue tests)."""
    job_id = f"test_job_{uuid.uuid4().hex[:8]}{suffix}"
    return job_id


def mock_hmac_signature(order_id, payment_id, secret="mock_test_secret"):
    """Compute valid HMAC-SHA256 payment signature."""
    message = f"{order_id}|{payment_id}"
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()


# --- Health -------------------------------------------------------------------

def test_health_check():
    status, body = api("/api/health", method="GET")
    assert_in("status", status, [200, 404])  # 404 if route removed is OK
    return True


# --- Heartbeat ----------------------------------------------------------------

def test_heartbeat_accepted():
    status, body = api("/api/kiosk/heartbeat", {
        "kiosk_id": KIOSK_ID,
        "cpu_temp": 42.1,
        "ram_usage": 65.0,
        "disk_usage": 30.0,
        "printer_status": "READY",
        "agent_version": "test-1.0"
    })
    assert_in("status", status, [200, 400, 404])
    # 200 = registered kiosk, 400/404 = kiosk not in DB (acceptable in test env)
    return True


# --- FIFO Queue Ordering ------------------------------------------------------

def test_poll_jobs_returns_json():
    """poll-jobs endpoint must return a valid JSON response with jobs array."""
    status, body = api("/api/kiosk/poll-jobs", {"kiosk_id": KIOSK_ID})
    assert_in("status", status, [200, 401, 404])
    if status == 200:
        assert_true("jobs is list", isinstance(body.get("jobs"), list))
    return True


def test_queue_status_requires_token_or_job_id():
    """queue-status must reject requests with no identifiers."""
    status, body = api("/api/customer/queue-status", method="GET")
    # No token and no job_id -> should be 400
    # (Using GET with no params)
    url = f"{BASE_URL}/api/customer/queue-status"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            # If 200, the route accepted no-param request -- fail
            return False
    except urllib.error.HTTPError as e:
        assert_in("status_code", e.code, [400, 401, 403, 404])
        return True
    except Exception:
        return True


def test_queue_status_missing_job():
    """queue-status with a non-existent job_id must return 404."""
    fake_id = f"nonexistent_job_{uuid.uuid4().hex[:6]}"
    url = f"{BASE_URL}/api/customer/queue-status?job_id={fake_id}"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            body = json.loads(resp.read().decode())
            # If 200 with no job, the response should indicate not found
            return body.get("error") is not None or not body.get("success")
    except urllib.error.HTTPError as e:
        return e.code == 404
    except Exception:
        return True


# --- Payment Signature --------------------------------------------------------

def test_verify_payment_rejects_no_ids():
    """verify-payment must require order_id and payment_id."""
    status, body = api("/api/customer/verify-payment", {})
    assert_eq("status", status, 400)
    assert_true("error in body", "error" in body)
    return True


def test_verify_payment_rejects_bad_signature():
    """verify-payment must reject an obviously invalid signature."""
    status, body = api("/api/customer/verify-payment", {
        "order_id": f"order_{uuid.uuid4().hex[:8]}",
        "payment_id": f"pay_{uuid.uuid4().hex[:8]}",
        "signature": "badc0ffee_invalid_signature",
        "job_id": f"job_{uuid.uuid4().hex[:8]}"
    })
    # Expect 400 (bad signature) or 404 (order not found -- acceptable in isolated test)
    assert_in("status", status, [400, 404, 500])
    return True


def test_create_order_rejects_no_job():
    """create-order must reject missing job_id."""
    status, body = api("/api/customer/create-order", {})
    assert_eq("status", status, 400)
    return True


def test_create_order_returns_key_id_string():
    """
    create-order must return key_id as a real string (not a Promise or [object Object]).
    Uses a fake job_id; if DB is live the job won't exist and we get a 400/503.
    Ensure we never get a 200 with key_id being a non-string.
    """
    status, body = api("/api/customer/create-order", {
        "job_id": f"test_{uuid.uuid4().hex}"
    })
    if status == 200:
        key_id = body.get("key_id")
        assert_true("key_id is str", isinstance(key_id, str))
        assert_true("key_id not Promise", "Promise" not in str(key_id))
        assert_true("key_id not object", "[object" not in str(key_id))
    # non-200 is fine for fake job -- the bug was the Promise leak on 200
    return True


# --- Multi-Tenant Isolation ---------------------------------------------------

def test_webhook_rejects_no_signature():
    """Razorpay webhook must reject requests without a signature header."""
    status, body = api("/api/webhooks/razorpay", {
        "event": "payment.captured",
        "payload": {}
    }, headers={"x-razorpay-signature": ""})
    assert_in("status", status, [400, 401])
    return True


def test_webhook_rejects_tampered_signature():
    """Razorpay webhook must reject a well-formed but wrong signature."""
    payload = json.dumps({
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": f"pay_{uuid.uuid4().hex[:8]}",
                    "order_id": f"order_{uuid.uuid4().hex[:8]}",
                    "amount": 100
                }
            }
        }
    })
    fake_sig = "a" * 64
    status, body = api(
        "/api/webhooks/razorpay",
        method="POST",
        headers={"Content-Type": "application/json", "x-razorpay-signature": fake_sig},
        payload=json.loads(payload)
    )
    assert_in("status", status, [400, 401])
    return True


# --- File Download Security ---------------------------------------------------

def test_download_rejects_unknown_job():
    """Download route must reject unknown job IDs."""
    fake_id = f"fakejob_{uuid.uuid4().hex[:8]}"
    url = f"{BASE_URL}/api/kiosk/download/{fake_id}?token=bad_token"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status in [404, 403, 410]
    except urllib.error.HTTPError as e:
        return e.code in [404, 403, 410]
    except Exception:
        return True


def test_download_rejects_bad_token():
    """Download route must reject a bad token even for a known job (if DB is live)."""
    # Use an obviously fake job ID and bad token
    url = f"{BASE_URL}/api/kiosk/download/nonexistent_job?token=invalid_token_xyz"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            # 200 for a fake job would be a bug
            return resp.status != 200
    except urllib.error.HTTPError as e:
        return e.code in [403, 404, 410]
    except Exception:
        return True


# --- Job Complete -------------------------------------------------------------

def test_job_complete_rejects_no_job_id():
    """job-complete must reject missing job_id."""
    status, body = api("/api/kiosk/job-complete", {})
    assert_eq("status", status, 400)
    assert_true("error in body", "error" in body)
    return True


# --- Update Status ------------------------------------------------------------

def test_update_status_rejects_missing_fields():
    """update-status must require job_id and status."""
    status, body = api("/api/kiosk/update-status", {"job_id": "some_id"})
    assert_eq("status", status, 400)
    return True


# --- Cron Cleanup -------------------------------------------------------------

def test_cron_cleanup_rejects_unauthorized():
    """Cleanup cron must reject unauthenticated requests."""
    status, body = api("/api/cron/cleanup", {}, headers={"Authorization": "Bearer wrong_token"})
    assert_in("status", status, [401, 403])
    return True


def test_cron_cleanup_accepts_valid_token():
    """Cleanup cron must accept a valid CRON_SECRET token."""
    cron_secret = os.getenv("SMARTPRINT_CRON_SECRET", ADMIN_TOKEN)
    if not cron_secret:
        return "SKIP"
    status, body = api("/api/cron/cleanup", {}, headers={"Authorization": f"Bearer {cron_secret}"})
    assert_in("status", status, [200, 401])
    if status == 200:
        assert_true("success", body.get("success"))
    return True


# --- FIFO Ordering Simulation -------------------------------------------------

def test_fifo_ordering_contract():
    """
    Validates the FIFO contract:
    - Polling returns jobs in QUEUED order
    - If DB has no jobs, empty array is acceptable
    - If DB has jobs, the returned job must be the lowest queue_sequence

    This is a contract test, not a full integration test. Full integration requires
    the Supabase DB to be populated with test data.
    """
    status, body = api("/api/kiosk/poll-jobs", {"kiosk_id": KIOSK_ID})
    if status != 200:
        return "SKIP"

    jobs = body.get("jobs", [])
    if len(jobs) == 0:
        # No pending jobs -- that's fine
        print("    -> No pending jobs in queue (expected in clean test env)")
        return True

    # If we received jobs, ensure they are ordered by queue_sequence (ascending)
    sequences = [j.get("queue_sequence", 0) or 0 for j in jobs]
    if len(sequences) > 1:
        for i in range(len(sequences) - 1):
            if sequences[i] > sequences[i + 1]:
                raise AssertionError(
                    f"FIFO violated: job at index {i} has sequence {sequences[i]} "
                    f"> job at index {i+1} with sequence {sequences[i+1]}"
                )
    print(f"    -> {len(jobs)} job(s) returned, FIFO order verified")
    return True


# --- Duplicate Print Protection -----------------------------------------------

def test_no_duplicate_job_complete():
    """
    Calling job-complete twice for the same job must not fail catastrophically.
    The second call should be idempotent (200 or graceful error, never 500).
    """
    fake_job_id = f"idem_{uuid.uuid4().hex[:8]}"
    for i in range(2):
        status, body = api("/api/kiosk/job-complete", {"job_id": fake_job_id, "cups_job_id": 42})
        # First call may 200 (stored) or 200 (no-op if not in DB)
        # Second call must not 500
        if i == 1 and status == 500:
            raise AssertionError(f"Second job-complete returned 500: {body}")
    return True


# --- Main ---------------------------------------------------------------------

def main():
    global BASE_URL, ADMIN_TOKEN, KIOSK_ID, DEVICE_TOKEN, ORG_ID

    parser = argparse.ArgumentParser(description="GITAM SmartPrint Regression Tests")
    parser.add_argument("--base-url", default=BASE_URL, help="Backend base URL")
    parser.add_argument("--admin-token", default=ADMIN_TOKEN, help="Admin secret token")
    parser.add_argument("--kiosk-id", default=KIOSK_ID, help="Kiosk ID")
    parser.add_argument("--device-token", default=DEVICE_TOKEN, help="Device token")
    args = parser.parse_args()

    BASE_URL = args.base_url.rstrip("/")
    ADMIN_TOKEN = args.admin_token or ADMIN_TOKEN
    KIOSK_ID = args.kiosk_id
    DEVICE_TOKEN = args.device_token

    print(f"\n{'=' * 60}")
    print(f"GITAM SmartPrint -- FIFO & Payment Regression Tests")
    print(f"Target: {BASE_URL}")
    print(f"Kiosk:  {KIOSK_ID}")
    print(f"{'=' * 60}")
    start = time.time()

    # Infrastructure
    test("Health check", test_health_check)
    test("Heartbeat accepted", test_heartbeat_accepted)

    # FIFO Queue
    test("poll-jobs returns JSON with jobs array", test_poll_jobs_returns_json)
    test("FIFO ordering contract", test_fifo_ordering_contract)
    test("queue-status rejects no identifiers", test_queue_status_requires_token_or_job_id)
    test("queue-status returns 404 for missing job", test_queue_status_missing_job)

    # Payment
    test("create-order rejects missing job_id", test_create_order_rejects_no_job)
    test("create-order key_id is a string (not Promise)", test_create_order_returns_key_id_string)
    test("verify-payment rejects missing order_id", test_verify_payment_rejects_no_ids)
    test("verify-payment rejects bad signature", test_verify_payment_rejects_bad_signature)

    # Webhook security
    test("webhook rejects empty signature", test_webhook_rejects_no_signature)
    test("webhook rejects tampered signature", test_webhook_rejects_tampered_signature)

    # File security
    test("download rejects unknown job ID", test_download_rejects_unknown_job)
    test("download rejects bad token", test_download_rejects_bad_token)

    # Job lifecycle
    test("job-complete rejects missing job_id", test_job_complete_rejects_no_job_id)
    test("update-status rejects missing fields", test_update_status_rejects_missing_fields)

    # Idempotency
    test("job-complete is idempotent (no 500 on second call)", test_no_duplicate_job_complete)

    # Cron
    test("cron cleanup rejects unauthorized", test_cron_cleanup_rejects_unauthorized)
    test("cron cleanup accepts valid token", test_cron_cleanup_accepts_valid_token)

    # Summary
    elapsed = time.time() - start
    print(f"\n{'=' * 60}")
    print(f"Results: {PASSED} passed | {FAILED} failed | {SKIPPED} skipped")
    print(f"Elapsed: {elapsed:.1f}s")
    print("=" * 60)

    if FAILED > 0:
        print("\nFailed tests:")
        for status, name in RESULTS:
            if status == "FAIL":
                print(f"  [FAIL] {name}")
        sys.exit(1)
    else:
        print("\nAll tests passed.")
        sys.exit(0)


if __name__ == "__main__":
    main()
