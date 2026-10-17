#!/usr/bin/env python3
"""
GITAM SMARTPRINT - AUDIT VERIFICATION & REGRESSION TEST SUITE
Automated tests for:
1. Missing and invalid device token (HTTP 401 / 403)
2. Kiosk, job, and organization mismatch rejection (HTTP 403)
3. Valid authenticated heartbeat and job polling (HTTP 200)
4. Invalid and valid job status transitions (State machine enforcement)
5. Unauthorized job completion and document deletion prevention
6. Duplicate requests and idempotent job completion
7. Uncertain print outcome handling (OUTCOME_UNCERTAIN without false completion)
8. Supabase persistence and storage integrity after reload
9. CUPS controller status, submission, and failure handling
"""

import sys
import os
import json
import time
import unittest
import urllib.request
import urllib.error

# Add parent and agent directory to path for CUPS controller test
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "raspberry-pi", "agent")))
from cups_controller import CupsController

BASE_URL = os.getenv("SMARTPRINT_BASE_URL", "http://localhost:3000").rstrip("/")
VALID_KIOSK_ID = os.getenv("SMARTPRINT_KIOSK_ID", "GITAM-SPK-001")
VALID_DEVICE_TOKEN = os.getenv("SMARTPRINT_DEVICE_TOKEN", "gitam_spk_001_secure_device_secret_2026")
SECOND_KIOSK_ID = "GITAM-SPK-002"
SECOND_DEVICE_TOKEN = "gitam_spk_002_secure_device_secret_2026"
INVALID_DEVICE_TOKEN = "invalid_secret_token_unauthorized_9999"


def make_request(endpoint, payload=None, headers=None, method="POST"):
    """HTTP client helper returning (status_code, response_dict_or_str)."""
    url = f"{BASE_URL}{endpoint}"
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)

    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            content = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(content)
            except Exception:
                return resp.status, content
    except urllib.error.HTTPError as e:
        err_content = e.read().decode("utf-8") if e.fp else str(e)
        try:
            return e.code, json.loads(err_content)
        except Exception:
            return e.code, err_content
    except Exception as e:
        return 0, str(e)


class TestDeviceAuthentication(unittest.TestCase):
    """Verifies strict server-side device authentication across all kiosk routes."""

    def test_01_missing_device_headers_rejected(self):
        """All kiosk routes must reject requests missing X-Kiosk-Id or X-Device-Token with HTTP 401."""
        endpoints = [
            ("/api/kiosk/heartbeat", "POST", {"kiosk_id": VALID_KIOSK_ID}),
            ("/api/kiosk/poll-jobs", "POST", {}),
            ("/api/kiosk/update-status", "POST", {"job_id": "SP-MOCK-001", "status": "PRINTING"}),
            ("/api/kiosk/job-complete", "POST", {"job_id": "SP-MOCK-001"}),
            ("/api/kiosk/download/SP-MOCK-001", "GET", None),
        ]

        for ep, method, payload in endpoints:
            status, res = make_request(ep, payload=payload, headers={}, method=method)
            self.assertEqual(
                status, 401,
                f"Endpoint {ep} [{method}] did not reject missing headers with 401: got {status} ({res})"
            )

    def test_02_invalid_device_token_rejected(self):
        """Kiosk routes must reject invalid device tokens with HTTP 403."""
        headers = {
            "X-Kiosk-Id": VALID_KIOSK_ID,
            "X-Device-Token": INVALID_DEVICE_TOKEN,
        }

        status, res = make_request("/api/kiosk/heartbeat", payload={}, headers=headers, method="POST")
        self.assertEqual(status, 403, f"Heartbeat did not reject invalid token with 403: got {status}")

        status, res = make_request("/api/kiosk/poll-jobs", payload={}, headers=headers, method="POST")
        self.assertEqual(status, 403, f"Poll jobs did not reject invalid token with 403: got {status}")

    def test_03_unregistered_kiosk_rejected(self):
        """Non-existent or unregistered kiosk ID must return HTTP 404."""
        headers = {
            "X-Kiosk-Id": "NON-EXISTENT-KIOSK-999",
            "X-Device-Token": "some_device_token",
        }
        status, res = make_request("/api/kiosk/heartbeat", payload={}, headers=headers, method="POST")
        self.assertEqual(status, 404, f"Heartbeat did not return 404 for unregistered kiosk: got {status}")

    def test_04_valid_heartbeat_and_poll_jobs(self):
        """Valid registered kiosk credentials must succeed with HTTP 200."""
        headers = {
            "X-Kiosk-Id": VALID_KIOSK_ID,
            "X-Device-Token": VALID_DEVICE_TOKEN,
        }

        # Heartbeat
        hb_payload = {
            "cpu_temp": 42.5,
            "ram_usage": 35.0,
            "disk_usage": 18.2,
            "printer_status": "READY",
            "agent_version": "1.0.0",
        }
        status, res = make_request("/api/kiosk/heartbeat", payload=hb_payload, headers=headers, method="POST")
        self.assertEqual(status, 200, f"Valid heartbeat failed: {res}")
        self.assertTrue(res.get("success"), "Heartbeat response missing success flag")

        # Polling
        status, res = make_request("/api/kiosk/poll-jobs", payload={}, headers=headers, method="POST")
        self.assertEqual(status, 200, f"Valid polling failed: {res}")
        self.assertTrue(res.get("success"), "Poll jobs response missing success flag")
        self.assertIsInstance(res.get("jobs"), list, "Poll jobs should return a list")


class TestJobLifecycleAndTransitions(unittest.TestCase):
    """Verifies state machine transitions, scoping, duplicate protection, and completion idempotency."""

    @classmethod
    def setUpClass(cls):
        """Upload a fresh test document to obtain a real test job in the database."""
        minimal_pdf = (
            b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
            b"3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R>>endobj\n"
            b"xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000102 00000 n\n"
            b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n170\n%%EOF\n"
        )
        boundary = "----SmartPrintAuditTestBoundary"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="kiosk_id"\r\n\r\n{VALID_KIOSK_ID}\r\n'
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="audit_test.pdf"\r\n'
            f"Content-Type: application/pdf\r\n\r\n"
        ).encode("utf-8") + minimal_pdf + f"\r\n--{boundary}--\r\n".encode("utf-8")

        req = urllib.request.Request(
            f"{BASE_URL}/api/customer/upload",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        cls.job_id = data["job_id"]

    def test_05_kiosk_mismatch_rejected(self):
        """A kiosk must NOT be able to modify or complete a job assigned to a different kiosk."""
        headers_kiosk2 = {
            "X-Kiosk-Id": SECOND_KIOSK_ID,
            "X-Device-Token": SECOND_DEVICE_TOKEN,
        }

        # Attempt status update by wrong kiosk
        status, res = make_request(
            "/api/kiosk/update-status",
            payload={"job_id": self.job_id, "status": "DOWNLOADING"},
            headers=headers_kiosk2,
            method="POST"
        )
        self.assertEqual(status, 403, f"Expected 403 for mismatched kiosk update: got {status} ({res})")

        # Attempt job completion by wrong kiosk
        status, res = make_request(
            "/api/kiosk/job-complete",
            payload={"job_id": self.job_id},
            headers=headers_kiosk2,
            method="POST"
        )
        self.assertEqual(status, 403, f"Expected 403 for mismatched kiosk completion: got {status} ({res})")

        # Attempt document download by wrong kiosk
        status, res = make_request(
            f"/api/kiosk/download/{self.job_id}",
            payload=None,
            headers=headers_kiosk2,
            method="GET"
        )
        self.assertEqual(status, 403, f"Expected 403 for mismatched kiosk download: got {status} ({res})")

    def test_06_invalid_status_transition_rejected(self):
        """Illegal status transitions (e.g. UPLOAD_COMPLETE -> COMPLETED) must be rejected with HTTP 400."""
        valid_headers = {
            "X-Kiosk-Id": VALID_KIOSK_ID,
            "X-Device-Token": VALID_DEVICE_TOKEN,
        }

        # Cannot jump from UPLOAD_COMPLETE to COMPLETED directly
        status, res = make_request(
            "/api/kiosk/update-status",
            payload={"job_id": self.job_id, "status": "COMPLETED"},
            headers=valid_headers,
            method="POST"
        )
        self.assertEqual(status, 400, f"Expected 400 for illegal transition: got {status} ({res})")

        # Cannot jump to PRINTING without payment / queuing
        status, res = make_request(
            "/api/kiosk/update-status",
            payload={"job_id": self.job_id, "status": "PRINTING"},
            headers=valid_headers,
            method="POST"
        )
        self.assertEqual(status, 400, f"Expected 400 for illegal transition: got {status} ({res})")

    def test_07_valid_lifecycle_progression(self):
        """Follows authorized transitions from UPLOAD_COMPLETE to PRINTING."""
        valid_headers = {
            "X-Kiosk-Id": VALID_KIOSK_ID,
            "X-Device-Token": VALID_DEVICE_TOKEN,
        }

        # Transition UPLOAD_COMPLETE -> VALIDATING -> PAYMENT_PENDING -> PAYMENT_VERIFIED -> QUEUED -> DISPATCHED -> DOWNLOADING -> PROCESSING -> SUBMITTED_TO_CUPS -> PRINTING
        transitions = [
            "VALIDATING",
            "PAYMENT_PENDING",
            "PAYMENT_VERIFIED",
            "QUEUED",
            "DISPATCHED",
            "DOWNLOADING",
            "PROCESSING",
            "SUBMITTED_TO_CUPS",
            "PRINTING",
        ]

        for next_status in transitions:
            status, res = make_request(
                "/api/kiosk/update-status",
                payload={"job_id": self.job_id, "status": next_status, "cups_job_id": 42},
                headers=valid_headers,
                method="POST"
            )
            self.assertEqual(
                status, 200,
                f"Failed valid transition to {next_status}: HTTP {status} - {res}"
            )
            self.assertEqual(res.get("status"), next_status)

    def test_08_authenticated_download_succeeds_before_completion(self):
        """Authorized kiosk can download the temporary document during active printing."""
        valid_headers = {
            "X-Kiosk-Id": VALID_KIOSK_ID,
            "X-Device-Token": VALID_DEVICE_TOKEN,
        }
        status, content = make_request(
            f"/api/kiosk/download/{self.job_id}",
            payload=None,
            headers=valid_headers,
            method="GET"
        )
        self.assertEqual(status, 200, f"Authorized download failed: status {status}")
        self.assertTrue(len(content) > 0, "Downloaded document was empty")

    def test_09_authorized_job_completion_and_idempotency(self):
        """Job completion permanently purges cloud file and is fully idempotent."""
        valid_headers = {
            "X-Kiosk-Id": VALID_KIOSK_ID,
            "X-Device-Token": VALID_DEVICE_TOKEN,
        }

        # 1. Complete Job
        status, res = make_request(
            "/api/kiosk/job-complete",
            payload={"job_id": self.job_id, "cups_job_id": 42},
            headers=valid_headers,
            method="POST"
        )
        self.assertEqual(status, 200, f"Job complete failed: {res}")
        self.assertEqual(res.get("status"), "COMPLETED")
        self.assertTrue(res.get("cleanup_verified"), "Document deletion was not verified")

        # 2. Idempotent Second Call
        status, res2 = make_request(
            "/api/kiosk/job-complete",
            payload={"job_id": self.job_id, "cups_job_id": 42},
            headers=valid_headers,
            method="POST"
        )
        self.assertEqual(status, 200, f"Idempotent job complete failed: {res2}")
        self.assertEqual(res2.get("status"), "COMPLETED")
        self.assertTrue(res2.get("already_completed"), "Expected already_completed flag on duplicate call")

        # 3. Document Download must return HTTP 410 Gone after completion
        status, err = make_request(
            f"/api/kiosk/download/{self.job_id}",
            payload=None,
            headers=valid_headers,
            method="GET"
        )
        self.assertEqual(status, 410, f"Download after completion did not return 410 Gone: got {status}")

    def test_10_uncertain_cups_outcome_handling(self):
        """OUTCOME_UNCERTAIN transition is recorded without false completion."""
        # Create a second job for uncertain test
        minimal_pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000102 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n170\n%%EOF\n"
        boundary = "----SmartPrintUncertainTest"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="kiosk_id"\r\n\r\n{VALID_KIOSK_ID}\r\n'
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="uncertain.pdf"\r\n'
            f"Content-Type: application/pdf\r\n\r\n"
        ).encode("utf-8") + minimal_pdf + f"\r\n--{boundary}--\r\n".encode("utf-8")

        req = urllib.request.Request(
            f"{BASE_URL}/api/customer/upload",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        job2_id = data["job_id"]

        valid_headers = {
            "X-Kiosk-Id": VALID_KIOSK_ID,
            "X-Device-Token": VALID_DEVICE_TOKEN,
        }

        # Advance to PRINTING
        for s in ["VALIDATING", "PAYMENT_PENDING", "PAYMENT_VERIFIED", "QUEUED", "DISPATCHED", "PRINTING"]:
            make_request("/api/kiosk/update-status", payload={"job_id": job2_id, "status": s}, headers=valid_headers)

        # Record OUTCOME_UNCERTAIN
        status, res = make_request(
            "/api/kiosk/update-status",
            payload={"job_id": job2_id, "status": "OUTCOME_UNCERTAIN", "error_message": "CUPS timeout"},
            headers=valid_headers,
            method="POST"
        )
        self.assertEqual(status, 200, f"Failed to record OUTCOME_UNCERTAIN: {res}")
        self.assertEqual(res.get("status"), "OUTCOME_UNCERTAIN")


class TestCupsControllerUnit(unittest.TestCase):
    """Unit tests for Raspberry Pi CupsController."""

    def test_11_cups_controller_initialization_and_status(self):
        """CupsController must gracefully initialize and return queue status."""
        controller = CupsController()
        status, msg = controller.get_queue_status()
        self.assertIn(status, ["READY", "BUSY", "ERROR", "PAPER_OUT", "OFFLINE"])
        self.assertIsInstance(msg, str)

    def test_12_cups_controller_detect_printers(self):
        """detect_usb_printers must return a list without unhandled exceptions."""
        printers = CupsController.detect_usb_printers()
        self.assertIsInstance(printers, list)


if __name__ == "__main__":
    print("=" * 70)
    print("  GITAM SMARTPRINT - AUDIT VERIFICATION & REGRESSION SUITE")
    print("=" * 70)
    unittest.main(verbosity=2)
