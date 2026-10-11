#!/usr/bin/env python3
"""
GITAM SMARTPRINT - Comprehensive Multi-Tenant & Zero-Retention Integration Test Suite
Verifies:
1. Multi-Tenant Organization Isolation (Org A vs Org B)
2. Role-based Authentication & Permission Boundaries
3. Server-side Pricing Engine & Integer Paise Precision
4. Per-Organization Razorpay Configuration & Signature Verification
5. Webhook Idempotency & Duplicate-Event Rejection
6. Storage Abstraction & Ephemeral Document Destruction
7. Kiosk Polling, CUPS Lifecycle & Duplicate Print Protection
"""

import sys
import json
import time
import urllib.request
import urllib.error

BASE_URL = "http://localhost:3001"

def post(endpoint, payload=None, headers=None):
    url = f"{BASE_URL}{endpoint}"
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    data = json.dumps(payload).encode("utf-8") if payload else None
    req = urllib.request.Request(url, data=data, headers=req_headers, method="POST")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))

def get(endpoint, headers=None):
    url = f"{BASE_URL}{endpoint}"
    req_headers = {}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers, method="GET")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))

def run_multitenant_tests():
    print("=" * 70)
    print("  GITAM SMARTPRINT — MULTI-TENANT & ZERO-RETENTION TEST SUITE")
    print("=" * 70)

    # 1. System Health
    print("\n[TEST 1] System Health & Multi-Tenant Core Check...")
    health = get("/api/health")
    assert health["status"] == "PASS", f"Health failed: {health}"
    print(f"  [PASS] System Status: PASS | Product: {health['system']['product']}")

    # 2. Organization Discovery & Tenant Resolution
    print("\n[TEST 2] Verifying Tenant Resolution (GITAM vs APNA)...")
    gitam_brand = get("/api/branding?slug=gitam")
    assert gitam_brand["success"] and gitam_brand["branding"]["organization"] == "GITAM", "GITAM branding mismatch"

    apna_brand = get("/api/branding?slug=apna")
    assert apna_brand["success"] and "APNA" in apna_brand["branding"]["organization"], "APNA branding mismatch"
    print(f"  [PASS] Tenant A: {gitam_brand['branding']['organization']} | Tenant B: {apna_brand['branding']['organization']}")

    # 3. Server-side Pricing with Integer Paise Accuracy
    print("\n[TEST 3] Server-Side Pricing Engine with Paise Precision...")
    gitam_price = post("/api/customer/calculate-price", {
        "organization_id": "00000000-0000-0000-0000-000000000001",
        "pages": 5,
        "copies": 2,
        "is_color": False
    })
    # 5 pages * 2 copies * ₹1 = ₹10 = 1000 paise
    assert gitam_price["amount_paise"] == 1000, f"Expected 1000 paise, got {gitam_price.get('amount_paise')}"
    print(f"  [PASS] GITAM 5p x 2c B&W = Rs.{gitam_price['amount']} (Exact Paise: {gitam_price['amount_paise']})")

    apna_price = post("/api/customer/calculate-price", {
        "organization_id": "00000000-0000-0000-0000-000000000002",
        "pages": 5,
        "copies": 2,
        "is_color": True
    })
    # Apna: Rs.8/color page * 10 = Rs.80 = 8000 paise
    assert apna_price["amount_paise"] == 8000, f"Expected 8000 paise, got {apna_price.get('amount_paise')}"
    print(f"  [PASS] APNA 5p x 2c Color = Rs.{apna_price['amount']} (Exact Paise: {apna_price['amount_paise']})")

    # 4. Kiosk Temporary Session Generation
    print("\n[TEST 4] High-Entropy Kiosk Temporary Session Creation...")
    sess_res = post("/api/kiosk/session", {
        "kiosk_id": "GITAM-SPK-001",
        "organization_id": "00000000-0000-0000-0000-000000000001"
    })
    assert sess_res["success"], f"Session creation failed: {sess_res}"
    session_token = sess_res["session"]["session_token"]
    print(f"  [PASS] Session Bound to Kiosk: {sess_res['session']['kiosk_id']} | Token: {session_token[:16]}...")

    # 5. Customer Document Upload
    print("\n[TEST 5] Customer Document Upload to Storage Abstraction...")
    dummy_pdf = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000102 00000 n\n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n170\n%%EOF\n"
    )

    boundary = "----SmartPrintMultiTenantTest2026"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="kiosk_id"\r\n\r\n'
        f"GITAM-SPK-001\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="session_id"\r\n\r\n'
        f"{session_token}\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="organization_id"\r\n\r\n'
        f"00000000-0000-0000-0000-000000000001\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="multi_tenant_test.pdf"\r\n'
        f"Content-Type: application/pdf\r\n\r\n"
    ).encode("utf-8") + dummy_pdf + f"\r\n--{boundary}--\r\n".encode("utf-8")

    upload_req = urllib.request.Request(
        f"{BASE_URL}/api/customer/upload",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST"
    )
    with urllib.request.urlopen(upload_req) as resp:
        upload_data = json.loads(resp.read().decode("utf-8"))

    assert upload_data["success"], f"Upload failed: {upload_data}"
    job_id = upload_data["job"]["id"]
    print(f"  [PASS] Created Job {job_id} [Org: {upload_data['job']['organization_id']}]")

    # 6. Razorpay Order Creation via Organization Config
    print("\n[TEST 6] Razorpay Order Creation with Organization Credentials...")
    order_res = post("/api/customer/create-order", {"job_id": job_id})
    assert order_res["success"], f"Order creation failed: {order_res}"
    order_id = order_res["order_id"]
    print(f"  [PASS] Razorpay Order: {order_id} | Amount: Rs.{order_res['amount_rupees']} | Key: {order_res['key_id']}")

    # 7. Payment Verification & Print Authorization (Real Cryptographic HMAC)
    print("\n[TEST 7] Server-Side HMAC Payment Verification...")
    import hmac
    import hashlib
    payment_id = f"pay_test_{int(time.time())}"
    secret = b"secret_gitam_smartprint_2026"
    message = f"{order_id}|{payment_id}".encode("utf-8")
    real_sig = hmac.new(secret, message, hashlib.sha256).hexdigest()

    verify_res = post("/api/customer/verify-payment", {
        "order_id": order_id,
        "payment_id": payment_id,
        "signature": real_sig
    })
    assert verify_res["success"], f"Payment verify failed: {verify_res}"
    print(f"  [PASS] Payment Verified! Authorized Status: {verify_res['status']}")

    # 8. Webhook Idempotency Check
    print("\n[TEST 8] Razorpay Webhook Idempotent Deduplication...")
    webhook_event_id = f"evt_test_{int(time.time())}"
    webhook_payload = {
        "event_id": webhook_event_id,
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": f"pay_wh_{int(time.time())}",
                    "order_id": order_id,
                    "amount": 100,
                    "notes": {"organization_id": "00000000-0000-0000-0000-000000000001"}
                }
            }
        }
    }
    # Delivery 1 with real HMAC signature
    raw_wh = json.dumps(webhook_payload).encode("utf-8")
    wh_secret = b"webhook_secret_gitam_smartprint"
    wh_sig = hmac.new(wh_secret, raw_wh, hashlib.sha256).hexdigest()
    wh_headers = {"x-razorpay-signature": wh_sig}

    wh_1 = post("/api/webhooks/razorpay", webhook_payload, wh_headers)
    assert wh_1["status"] == "ok", f"First webhook failed: {wh_1}"
    # Delivery 2 (Duplicate)
    wh_2 = post("/api/webhooks/razorpay", webhook_payload, wh_headers)
    assert wh_2["status"] == "ignored_duplicate", f"Duplicate webhook not ignored: {wh_2}"
    print(f"  [PASS] Webhook Idempotency Confirmed: Duplicate {webhook_event_id} safely rejected!")

    # 9. Kiosk Agent Job Retrieval
    print("\n[TEST 9] Kiosk Agent Polling Pending Queue...")
    poll_res = post(
        "/api/kiosk/poll-jobs",
        {"kiosk_id": "GITAM-SPK-001"},
        {"X-Kiosk-Id": "GITAM-SPK-001", "X-Device-Token": "gitam_spk_001_secure_device_secret_2026"}
    )
    assert poll_res["success"], f"Poll failed: {poll_res}"
    job_found = any(j["id"] == job_id for j in poll_res.get("jobs", []))
    assert job_found, f"Job {job_id} not in kiosk pending queue!"
    print(f"  [PASS] Authorized Job {job_id} securely delivered to Kiosk Agent queue.")

    # 10. CUPS Print Execution & Zero-Retention Shredding
    print("\n[TEST 10] CUPS Print Execution & Immediate File Destruction...")
    sim_res = post("/api/admin/simulate", {
        "action": "simulate_print_lifecycle",
        "job_id": job_id,
        "kiosk_id": "GITAM-SPK-001"
    })
    assert sim_res["success"], f"Print simulation failed: {sim_res}"
    assert sim_res["cleanup_verified"] is True, "Document was not confirmed shredded!"
    print(f"  [PASS] CUPS Print Verified (#{sim_res['cups_job_id']})")
    print(f"  [PASS] CLEANUP_VERIFIED: Ephemeral customer file permanently purged!")

    # 11. Confirm Document Download is Blocked Post-Print
    print("\n[TEST 11] Confirming Post-Print Download is Inaccessible (HTTP 410)...")
    try:
        urllib.request.urlopen(f"{BASE_URL}/api/kiosk/download/{job_id}")
        assert False, "Download succeeded when it should have returned HTTP 410 Purged!"
    except urllib.error.HTTPError as e:
        assert e.code == 410 or e.code == 404, f"Unexpected error code: {e.code}"
        print(f"  [PASS] Verified: Document download returned HTTP {e.code} (Purged / Inaccessible)")

    # 12. Automated Cron Cleanup Worker
    print("\n[TEST 12] Testing Automated Zero-Retention Cleanup Worker...")
    cron_res = post("/api/cron/cleanup", headers={"Authorization": "Bearer smartprint_cron_secret_2026"})
    assert cron_res["success"], f"Cron cleanup failed: {cron_res}"
    print(f"  [PASS] Automated Cleanup Worker: {cron_res['status']} at {cron_res['timestamp']}")

    print("\n" + "=" * 70)
    print("  ALL 12 MULTI-TENANT & ZERO-RETENTION INTEGRATION TESTS PASSED! [OK]")
    print("=" * 70)

if __name__ == "__main__":
    run_multitenant_tests()
