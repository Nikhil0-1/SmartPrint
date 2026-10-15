#!/usr/bin/env python3
"""
GITAM SMARTPRINT - End-to-End System Integration Test
"""

import urllib.request
import json
import time

import sys

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"

def post(endpoint, payload=None, headers=None):
    url = f"{BASE_URL}{endpoint}"
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    data = json.dumps(payload).encode("utf-8") if payload else None
    req = urllib.request.Request(url, data=data, headers=req_headers, method="POST")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))

def get(endpoint):
    url = f"{BASE_URL}{endpoint}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))

def run_tests():
    print("=" * 60)
    print("  GITAM SMARTPRINT - END-TO-END AUTOMATED VERIFICATION")
    print("=" * 60)

    # 1. Health check
    print("\n[TEST 1] System Health Check...")
    health = get("/api/health")
    assert health["status"] == "PASS", f"Health failed: {health}"
    print(f"  [PASS] Status: PASS | Kiosks Online: {health['components']['kiosks_online']}")

    # 2. Dynamic QR Session
    print("\n[TEST 2] Generating Dynamic QR Session...")
    sess_res = post("/api/kiosk/session", {"kiosk_id": "GITAM-SPK-001"})
    assert sess_res["success"], f"Session generation failed: {sess_res}"
    session_id = sess_res["session"]["id"]
    print(f"  [PASS] Session Created: {session_id} | Token: {sess_res['session']['session_token']}")

    # 3. Simulate File Upload via multipart form
    print("\n[TEST 3] Uploading Customer Document (PDF)...")
    minimal_pdf = (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000102 00000 n\n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n170\n%%EOF\n"
    )

    boundary = "----SmartPrintBoundaryTest2026"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="kiosk_id"\r\n\r\n'
        f"GITAM-SPK-001\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="session_id"\r\n\r\n'
        f"{session_id}\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="sample_assignment.pdf"\r\n'
        f"Content-Type: application/pdf\r\n\r\n"
    ).encode("utf-8") + minimal_pdf + f"\r\n--{boundary}--\r\n".encode("utf-8")

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
    print(f"  [PASS] Job Created: {job_id} | Pages: {upload_data['job']['pages_total']}")

    # 4. Server-Side Price Calculation
    print("\n[TEST 4] Calculating Price (2 Copies, B&W)...")
    price_res = post("/api/customer/calculate-price", {
        "job_id": job_id,
        "copies": 2,
        "is_color": False,
        "is_duplex": False,
        "pages_selected": "All"
    })
    assert price_res["success"], f"Price calc failed: {price_res}"
    print(f"  [PASS] Calculated Amount: Rs.{price_res['amount']} (Rate: Rs.{price_res['breakdown']['rate_per_page']}/page)")

    # 5. Create Payment Order
    print("\n[TEST 5] Creating Razorpay Order...")
    order_res = post("/api/customer/create-order", {"job_id": job_id})
    assert order_res["success"], f"Order failed: {order_res}"
    order_id = order_res["order_id"]
    print(f"  [PASS] Razorpay Order: {order_id} | Amount: Rs.{order_res['amount_rupees']}")

    # 6. Verify Payment & Authorize Single Print
    print("\n[TEST 6] Verifying UPI Payment Signature & Authorizing Print...")
    verify_res = post("/api/customer/verify-payment", {
        "order_id": order_id,
        "payment_id": f"pay_test_{int(time.time())}",
        "signature": "mock_sig_test"
    })
    assert verify_res["success"], f"Payment verify failed: {verify_res}"
    # After payment verification, job transitions to QUEUED (ready for kiosk polling)
    assert verify_res["status"] in ("QUEUED", "PAYMENT_VERIFIED"), f"Unexpected status: {verify_res['status']}"
    print(f"  [PASS] Payment Verified! Job State: {verify_res['status']} (Ready for kiosk dispatch)")

    # 7. Kiosk Polling Check
    print("\n[TEST 7] Kiosk Agent Polling Pending Jobs...")
    poll_res = post(
        "/api/kiosk/poll-jobs",
        {"kiosk_id": "GITAM-SPK-001"},
        {"X-Kiosk-Id": "GITAM-SPK-001", "X-Device-Token": "gitam_spk_001_secure_device_secret_2026"}
    )
    assert poll_res["success"], f"Poll failed: {poll_res}"
    pending_jobs = poll_res.get("jobs", [])
    matching_job = next((j for j in pending_jobs if j["id"] == job_id), None)
    assert matching_job is not None, f"Job {job_id} not returned in kiosk pending queue!"
    print(f"  [PASS] Kiosk received authorized job: {job_id}")

    # 8. CUPS Printing & Verified Document Destruction
    print("\n[TEST 8] Simulating CUPS Print Lifecycle & Verifying Document Destruction...")
    sim_res = post("/api/admin/simulate", {
        "action": "simulate_print_lifecycle",
        "job_id": job_id,
        "kiosk_id": "GITAM-SPK-001"
    }, headers={"Authorization": "Bearer test_admin_token"})
    assert sim_res["success"], f"Simulation failed: {sim_res}"
    assert sim_res["cleanup_verified"] is True, "Document was not confirmed purged!"
    print(f"  [PASS] Print Completed on CUPS #{sim_res['cups_job_id']}")
    print(f"  [PASS] CLEANUP_VERIFIED: Temporary customer document permanently deleted!")

    # 9. Verify Document is Inaccessible (HTTP 410 / 404)
    print("\n[TEST 9] Confirming Document Download is Permanently Blocked...")
    try:
        urllib.request.urlopen(f"{BASE_URL}/api/kiosk/download/{job_id}")
        assert False, "Download should have failed after deletion!"
    except urllib.error.HTTPError as e:
        print(f"  [PASS] Verified: Document returned HTTP {e.code} (Purged / Unavailable)")

    print("\n" + "=" * 60)
    print("  ALL 9 END-TO-END ACCEPTANCE TESTS PASSED SUCCESSFULLY! [OK]")
    print("=" * 60)

if __name__ == "__main__":
    run_tests()
