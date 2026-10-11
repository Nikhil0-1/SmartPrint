#!/usr/bin/env python3
"""
GITAM SMARTPRINT - Kiosk Monitor State Machine & Concurrency Test Suite
Verifies:
1. Physical HDMI Monitor remains static on IDLE until a document is uploaded.
2. Generating a session / scanning QR does NOT activate the monitor.
3. Successful document upload transitions monitor to DOCUMENT_RECEIVED.
4. Masked job IDs prevent leakage of private filenames or user identities.
5. Strict Concurrency: Simultaneous second upload to busy kiosk is rejected (HTTP 409).
6. State progression: DOCUMENT_RECEIVED -> PROCESSING (Awaiting Payment) -> PROCESSING (Payment Verified) -> PRINTING -> COMPLETED -> Reset to IDLE.
7. Post-completion automatic reset releases kiosk reservation.
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
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=req_headers, method="POST")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8")), resp.getcode()

def get(endpoint, headers=None):
    url = f"{BASE_URL}{endpoint}"
    req_headers = {}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers, method="GET")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8")), resp.getcode()

def upload_file(kiosk_id, filename="assignment.pdf"):
    minimal_pdf = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000102 00000 n\n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n170\n%%EOF\n"
    )
    boundary = "----SmartPrintKioskBoundary99"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="kiosk_id"\r\n\r\n{kiosk_id}\r\n'
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: application/pdf\r\n\r\n"
    ).encode("utf-8") + minimal_pdf + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = urllib.request.Request(
        f"{BASE_URL}/api/customer/upload",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8")), resp.getcode()
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode("utf-8")), e.code

def run_tests():
    print("=" * 70)
    print("  GITAM SMARTPRINT - MONITOR STATE MACHINE & CONCURRENCY VERIFICATION")
    print("=" * 70)

    kiosk_id = "GITAM-SPK-001"

    # Reset any prior job state to clean IDLE
    post(f"/api/kiosk/{kiosk_id}/status", {"action": "reset_idle", "force": True})

    # 1. State A: IDLE verification
    print("\n[TEST 1] Verifying Kiosk Initial State is IDLE...")
    status, code = get(f"/api/kiosk/{kiosk_id}/status")
    assert code == 200, f"Failed to get kiosk status: {status}"
    assert status["monitor_state"] == "IDLE", f"Expected IDLE, got {status['monitor_state']}"
    assert status["active_job"] is None, "Active job must be null in IDLE state"
    assert status["branding"]["support_number"] == "9006496970", "Support number mismatch"
    assert "Nikhil" in status["branding"]["powered_by"], "Powered by branding mismatch"
    print(f"  [PASS] Monitor State: {status['monitor_state']} | Support: {status['branding']['support_number']} | Powered By: {status['branding']['powered_by']}")

    # 2. Scanning QR / Customer session creation does NOT change monitor state
    print("\n[TEST 2] Verifying QR Scan / Session Creation does NOT activate monitor...")
    sess, code = post("/api/kiosk/session", {"kiosk_id": kiosk_id})
    assert code == 200
    status_after_scan, _ = get(f"/api/kiosk/{kiosk_id}/status")
    assert status_after_scan["monitor_state"] == "IDLE", f"Monitor should stay IDLE after session creation, got {status_after_scan['monitor_state']}"
    print(f"  [PASS] Monitor remains strictly IDLE after customer opens session.")

    # 3. Document Upload activates monitor to DOCUMENT_RECEIVED
    print("\n[TEST 3] Customer uploads valid document -> Monitor switches to DOCUMENT_RECEIVED...")
    upload_res, code = upload_file(kiosk_id, "student_lab_report.pdf")
    assert code == 200, f"Upload failed: {upload_res}"
    job_id = upload_res["job"]["id"]
    print(f"  [PASS] Upload succeeded: Job {job_id}")

    status_after_upload, _ = get(f"/api/kiosk/{kiosk_id}/status")
    assert status_after_upload["monitor_state"] == "DOCUMENT_RECEIVED", f"Expected DOCUMENT_RECEIVED, got {status_after_upload['monitor_state']}"
    assert status_after_upload["active_job"] is not None
    # Masked ID check: should mask inner portion
    masked = status_after_upload["active_job"]["masked_id"]
    assert "****" in masked, f"Job reference must be masked for privacy! Got: {masked}"
    assert "student_lab_report" not in json.dumps(status_after_upload), "Private filename must never be exposed on monitor!"
    print(f"  [PASS] Monitor transitioned to DOCUMENT_RECEIVED | Masked Reference: {masked}")

    # 4. Strict Concurrency: Second customer trying to upload to same kiosk is REJECTED
    print("\n[TEST 4] Concurrency Protection: Second customer upload to busy kiosk must be REJECTED...")
    conflict_res, conflict_code = upload_file(kiosk_id, "second_student_assignment.pdf")
    assert conflict_code == 409, f"Expected HTTP 409 Conflict, got {conflict_code}: {conflict_res}"
    assert "busy" in conflict_res.get("error", "").lower() or "another" in conflict_res.get("error", "").lower(), f"Unexpected error: {conflict_res}"
    print(f"  [PASS] Second customer upload rejected atomically (HTTP 409): {conflict_res.get('error')}")

    # Ensure monitor state was NOT overwritten by second customer
    status_check, _ = get(f"/api/kiosk/{kiosk_id}/status")
    assert status_check["active_job"]["masked_id"] == masked, "Active job was illegally modified by conflicting upload!"
    print(f"  [PASS] Active job remains exclusively assigned to Customer 1 ({masked}).")

    # 5. Customer proceeds to payment -> Monitor shows PROCESSING (Awaiting Payment)
    print("\n[TEST 5] Order Created -> Monitor displays PROCESSING (Awaiting payment)...")
    post("/api/kiosk/update-status", {"job_id": job_id, "status": "PAYMENT_PENDING"})
    status_payment_pending, _ = get(f"/api/kiosk/{kiosk_id}/status")
    assert status_payment_pending["monitor_state"] == "PROCESSING", f"Expected PROCESSING, got {status_payment_pending['monitor_state']}"
    assert "payment" in status_payment_pending["sub_message"].lower(), f"Expected payment sub-message, got {status_payment_pending['sub_message']}"
    print(f"  [PASS] Monitor State: PROCESSING | Status message: {status_payment_pending['sub_message']}")

    # 6. Payment verified -> Monitor displays PROCESSING (Preparing Print Job)
    print("\n[TEST 6] Payment Verified -> Monitor displays PROCESSING (Payment verified)...")
    post("/api/kiosk/update-status", {"job_id": job_id, "status": "PAYMENT_VERIFIED"})
    status_verified, _ = get(f"/api/kiosk/{kiosk_id}/status")
    assert status_verified["monitor_state"] == "PROCESSING"
    print(f"  [PASS] Monitor State: PROCESSING | Message: {status_verified['sub_message']}")

    # 7. Kiosk agent accepts and prints -> Monitor displays PRINTING
    print("\n[TEST 7] Kiosk Agent transitions to PRINTING -> Monitor displays PRINTING...")
    post("/api/kiosk/update-status", {"job_id": job_id, "status": "PRINTING"})
    status_printing, _ = get(f"/api/kiosk/{kiosk_id}/status")
    assert status_printing["monitor_state"] == "PRINTING", f"Expected PRINTING, got {status_printing['monitor_state']}"
    print(f"  [PASS] Monitor State: PRINTING | Instruction: Collect from output tray.")

    # 8. CUPS prints and deletes file -> Monitor displays COMPLETED
    print("\n[TEST 8] CUPS job complete -> Monitor displays COMPLETED with cleanup notice...")
    complete_res, _ = post("/api/kiosk/job-complete", {"job_id": job_id, "cups_job_id": 991})
    assert complete_res["cleanup_verified"] is True, "Document cleanup must be verified upon job completion"
    status_completed, _ = get(f"/api/kiosk/{kiosk_id}/status")
    assert status_completed["monitor_state"] == "COMPLETED", f"Expected COMPLETED, got {status_completed['monitor_state']}"
    print(f"  [PASS] Monitor State: COMPLETED | Cleanup Verified: Document shredded.")

    # 9. Timeout / Reset releases kiosk back to IDLE
    print("\n[TEST 9] Resetting kiosk back to static IDLE...")
    reset_res, _ = post(f"/api/kiosk/{kiosk_id}/status", {"action": "reset_idle"})
    assert reset_res["success"] is True
    status_idle_again, _ = get(f"/api/kiosk/{kiosk_id}/status")
    assert status_idle_again["monitor_state"] == "IDLE"
    assert status_idle_again["active_job"] is None
    print(f"  [PASS] Kiosk successfully returned to static IDLE screen.")

    # 10. Now new uploads are accepted again
    print("\n[TEST 10] New Customer Upload accepted after reset...")
    new_upload, new_code = upload_file(kiosk_id, "next_student_file.pdf")
    assert new_code == 200
    print(f"  [PASS] Next customer job accepted smoothly: {new_upload['job']['id']}")

    # Clean up the test job
    post(f"/api/kiosk/{kiosk_id}/status", {"action": "reset_idle", "force": True})

    print("\n" + "=" * 70)
    print("  ALL 10 KIOSK MONITOR STATE & CONCURRENCY TESTS PASSED! [OK]")
    print("=" * 70)

if __name__ == "__main__":
    run_tests()
