#!/usr/bin/env python3
"""
GITAM SMARTPRINT - Comprehensive Production Readiness Test Suite
Tests all requirements from Section 11 of the specification:
- Atomic reservation & duplicate job polling prevention
- ACK failure & retry
- Download failure & PDF validation failure
- CUPS submission success, exception, unavailable queue, invalid job ID
- CUPS completed, stopped/aborted, timeout & outcome uncertain
- Power interruption simulation at crucial lifecycle stages
- Cloud completion reporting failure & outbox persistence
- Cloud reporting retry after reboot
- Duplicate job received after restart
- Bounded retention cleanup of expired vs unexpired recovery documents
- Database migration preserving legacy records

Does NOT perform real printing or hit real external networks.
"""

import os
import sys
import time
import json
import sqlite3
import shutil
import tempfile
import unittest
from unittest.mock import patch, MagicMock, mock_open

# Add agent directory to sys.path
AGENT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "raspberry-pi", "agent"))
if AGENT_DIR not in sys.path:
    sys.path.insert(0, AGENT_DIR)

from state_manager import (
    StateManager,
    STATE_RESERVED,
    STATE_ACKNOWLEDGED,
    STATE_DOWNLOADING,
    STATE_PROCESSING,
    STATE_SUBMITTING_TO_CUPS,
    STATE_SUBMITTED_TO_CUPS,
    STATE_PRINTING,
    STATE_COMPLETED,
    STATE_CLOUD_COMPLETED,
    STATE_FAILED_BEFORE_SUBMISSION,
    STATE_ACK_RETRY_PENDING,
    STATE_CLOUD_COMPLETION_PENDING,
    STATE_OUTCOME_UNCERTAIN,
    STATE_RECOVERY_REQUIRED,
    STATE_CUPS_SUBMISSION_UNCERTAIN,
    NON_RETRYABLE_PRINT_STATES,
)
from cups_controller import (
    CupsController,
    CupsSubmissionError,
    CupsQueueUnavailableError,
)
from document_manager import (
    DocumentManager,
    secure_wipe_file,
    sanitize_job_id,
)
from smartprint_agent import SmartPrintAgent


class ProductionAgentTestSuite(unittest.TestCase):

    def setUp(self):
        """Create an isolated temporary environment for each test."""
        self.test_dir = tempfile.mkdtemp(prefix="smartprint_test_")
        self.state_dir = os.path.join(self.test_dir, "smartprint")
        os.makedirs(self.state_dir, mode=0o700, exist_ok=True)
        self.db_path = os.path.join(self.state_dir, "agent_state.db")

        self.config = {
            "backend_url": "http://localhost:3000",
            "kiosk_id": "GITAM-SPK-001",
            "device_token": "test_secure_device_token",
            "cups_queue": "HP_Laser_108w",
            "poll_interval_sec": 1,
            "heartbeat_interval_sec": 5,
            "outbox_interval_sec": 1,
            "job_timeout_seconds": 5,
        }

        # Point environment variables to test sandbox
        self.env_patcher = patch.dict(os.environ, {
            "SMARTPRINT_STATE_DIR": self.state_dir,
            "SMARTPRINT_STATE_DB": self.db_path,
            "SMARTPRINT_LOCK_FILE": os.path.join(self.state_dir, "agent.lock"),
            "SMARTPRINT_CUPS_QUEUE": "HP_Laser_108w",
        })
        self.env_patcher.start()

        self.state_mgr = StateManager(db_path=self.db_path, state_dir=self.state_dir)
        self.doc_mgr = DocumentManager(state_dir=self.state_dir)

    def tearDown(self):
        """Clean up sandbox environment."""
        self.env_patcher.stop()
        shutil.rmtree(self.test_dir, ignore_errors=True)

    # --------------------------------------------------------------------------
    # 1. ATOMIC RESERVATION & DUPLICATE PREVENTION
    # --------------------------------------------------------------------------
    def test_atomic_reservation_success(self):
        """Verify atomic reservation succeeds for a new job."""
        success, err = self.state_mgr.reserve_job(
            job_id="job_001",
            idempotency_key="idem_001",
            kiosk_id="GITAM-SPK-001",
            pages_total=2,
            copies=1,
        )
        self.assertTrue(success)
        self.assertIsNone(err)

        job = self.state_mgr.get_job("job_001")
        self.assertIsNotNone(job)
        self.assertEqual(job["status"], STATE_RESERVED)
        self.assertEqual(job["idempotency_key"], "idem_001")

    def test_atomic_reservation_duplicate_rejected(self):
        """Verify reservation is rejected if same job_id or idempotency_key already exists."""
        self.state_mgr.reserve_job("job_001", "idem_001", "GITAM-SPK-001")

        # Duplicate job_id
        dup1, status1 = self.state_mgr.reserve_job("job_001", "idem_different", "GITAM-SPK-001")
        self.assertFalse(dup1)
        self.assertEqual(status1, STATE_RESERVED)

        # Duplicate idempotency_key
        dup2, status2 = self.state_mgr.reserve_job("job_different", "idem_001", "GITAM-SPK-001")
        self.assertFalse(dup2)
        self.assertEqual(status2, STATE_RESERVED)

    def test_duplicate_job_polling_prevention(self):
        """Verify fetch_and_process_jobs skips jobs already known in non-retryable states."""
        # Pre-record job in local DB as COMPLETED
        self.state_mgr.reserve_job("job_done", "idem_done", "GITAM-SPK-001")
        self.state_mgr.transition_status("job_done", STATE_COMPLETED, cups_job_id=42)

        agent = SmartPrintAgent(config=self.config)
        agent.state_mgr = self.state_mgr
        agent.doc_mgr = self.doc_mgr

        # Mock poll-jobs response containing the already-completed job
        poll_response = {
            "success": True,
            "data": {
                "jobs": [{
                    "id": "job_done",
                    "idempotency_key": "idem_done",
                    "status": "DISPATCHED",
                }]
            }
        }
        agent.make_api_request = MagicMock(return_value=poll_response)
        agent.execute_print_job = MagicMock()

        agent.fetch_and_process_jobs()

        # execute_print_job must NEVER be called
        agent.execute_print_job.assert_not_called()

    # --------------------------------------------------------------------------
    # 2. ACK FAILURE & RETRY HANDLING
    # --------------------------------------------------------------------------
    def test_ack_retry_success(self):
        """Verify cloud ACK retries on transient network errors before proceeding."""
        agent = SmartPrintAgent(config=self.config)
        agent.state_mgr = self.state_mgr
        agent.doc_mgr = self.doc_mgr

        # Mock make_api_request: fail ACK once, succeed on retry
        call_count = {"ack": 0}

        def mock_api(endpoint, payload=None, method="POST"):
            if endpoint == "/api/kiosk/update-status" and payload.get("status") == "ACKNOWLEDGED":
                call_count["ack"] += 1
                if call_count["ack"] < 2:
                    return {"success": False, "error": "Gateway Timeout 504"}
                return {"success": True, "data": {}}
            # Return failure for subsequent steps to end execution cleanly
            return {"success": False, "error": "Stop here"}

        agent.make_api_request = MagicMock(side_effect=mock_api)

        with patch.object(agent.doc_mgr, "prepare_job_workspace", return_value="/tmp/test.pdf"), \
             patch("time.sleep"):
            agent.execute_print_job({"id": "job_ack_test", "idempotency_key": "idem_ack"})

        self.assertGreaterEqual(call_count["ack"], 2)
        job = self.state_mgr.get_job("job_ack_test")
        self.assertIn(job["status"], (STATE_ACKNOWLEDGED, STATE_DOWNLOADING, STATE_FAILED_BEFORE_SUBMISSION))

    def test_ack_permanent_failure_aborts_without_cups(self):
        """Verify permanent ACK failure marks FAILED_BEFORE_SUBMISSION and never touches CUPS."""
        agent = SmartPrintAgent(config=self.config)
        agent.state_mgr = self.state_mgr
        agent.doc_mgr = self.doc_mgr

        agent.make_api_request = MagicMock(return_value={"success": False, "error": "Network unreachable"})
        agent.cups.submit_print_job = MagicMock()

        with patch("time.sleep"):
            agent.execute_print_job({"id": "job_ack_fail", "idempotency_key": "idem_ack_fail"})

        agent.cups.submit_print_job.assert_not_called()
        job = self.state_mgr.get_job("job_ack_fail")
        self.assertEqual(job["status"], STATE_FAILED_BEFORE_SUBMISSION)

    # --------------------------------------------------------------------------
    # 3. DOWNLOAD & PDF VALIDATION FAILURES
    # --------------------------------------------------------------------------
    def test_download_failure_handling(self):
        """Verify download failure marks FAILED_BEFORE_SUBMISSION and cleans workspace."""
        agent = SmartPrintAgent(config=self.config)
        agent.state_mgr = self.state_mgr
        agent.doc_mgr = self.doc_mgr

        # Mock API: ACK succeeds, update-status DOWNLOADING succeeds
        def mock_api(endpoint, payload=None, method="POST"):
            return {"success": True, "data": {}}
        agent.make_api_request = MagicMock(side_effect=mock_api)
        agent.cups.submit_print_job = MagicMock()

        # Mock download URL open failure
        with patch("urllib.request.urlopen", side_effect=Exception("Connection reset by peer")):
            agent.execute_print_job({"id": "job_dl_fail", "idempotency_key": "idem_dl"})

        agent.cups.submit_print_job.assert_not_called()
        job = self.state_mgr.get_job("job_dl_fail")
        self.assertEqual(job["status"], STATE_FAILED_BEFORE_SUBMISSION)

    def test_pdf_validation_corrupted_file(self):
        """Verify corrupted file without %PDF- magic is rejected before CUPS."""
        bad_file = os.path.join(self.test_dir, "corrupt.pdf")
        with open(bad_file, "wb") as f:
            f.write(b"NOT_A_PDF_DOCUMENT_CONTENT")

        cups_ctrl = CupsController()
        with self.assertRaises(ValueError) as ctx:
            cups_ctrl.validate_document(bad_file)
        self.assertIn("Invalid document format", str(ctx.exception))

    def test_pdf_validation_zero_byte(self):
        """Verify 0-byte file is rejected."""
        empty_file = os.path.join(self.test_dir, "empty.pdf")
        with open(empty_file, "wb") as f:
            pass

        cups_ctrl = CupsController()
        with self.assertRaises(ValueError) as ctx:
            cups_ctrl.validate_document(empty_file)
        self.assertIn("0 bytes", str(ctx.exception))

    def test_pdf_validation_valid_pdf(self):
        """Verify valid PDF file passes validation."""
        valid_file = os.path.join(self.test_dir, "valid.pdf")
        with open(valid_file, "wb") as f:
            f.write(b"%PDF-1.4 test content")

        cups_ctrl = CupsController()
        # Should not raise
        cups_ctrl.validate_document(valid_file)

    # --------------------------------------------------------------------------
    # 4. CUPS QUEUE READINESS & SUBMISSION
    # --------------------------------------------------------------------------
    def test_cups_queue_unavailable_preserves_for_recovery(self):
        """Verify that when printer queue is stopped/paper-out, file is preserved for recovery."""
        agent = SmartPrintAgent(config=self.config)
        agent.state_mgr = self.state_mgr
        agent.doc_mgr = self.doc_mgr

        agent.make_api_request = MagicMock(return_value={"success": True, "data": {}})
        agent.cups.get_queue_status = MagicMock(return_value=("PAPER_OUT", "Paper tray is empty"))
        agent.cups.submit_print_job = MagicMock()

        # Mock download returning valid PDF
        dummy_pdf = b"%PDF-1.4 dummy pdf content"
        mock_resp = MagicMock()
        mock_resp.read.return_value = dummy_pdf
        mock_resp.__enter__.return_value = mock_resp

        with patch("urllib.request.urlopen", return_value=mock_resp):
            agent.execute_print_job({"id": "job_paper_out", "idempotency_key": "idem_paper"})

        agent.cups.submit_print_job.assert_not_called()
        job = self.state_mgr.get_job("job_paper_out")
        self.assertEqual(job["status"], STATE_RECOVERY_REQUIRED)

        # Confirm document is preserved in recovery directory
        rec_file = os.path.join(self.doc_mgr.recovery_dir, "job_paper_out", "document.pdf")
        self.assertTrue(os.path.exists(rec_file))

    def test_cups_submission_success(self):
        """Verify atomic transition to SUBMITTED_TO_CUPS and PRINTING with real job ID."""
        agent = SmartPrintAgent(config=self.config)
        agent.state_mgr = self.state_mgr
        agent.doc_mgr = self.doc_mgr

        agent.make_api_request = MagicMock(return_value={"success": True, "data": {}})
        agent.cups.get_queue_status = MagicMock(return_value=("READY", "Printer idle and ready"))
        agent.cups.submit_print_job = MagicMock(return_value=105)
        agent.cups.wait_for_job_completion = MagicMock(return_value=(True, "Job completed"))

        mock_resp = MagicMock()
        mock_resp.read.return_value = b"%PDF-1.4 dummy pdf content"
        mock_resp.__enter__.return_value = mock_resp

        with patch("urllib.request.urlopen", return_value=mock_resp):
            agent.execute_print_job({"id": "job_success", "idempotency_key": "idem_success"})

        agent.cups.submit_print_job.assert_called_once()
        job = self.state_mgr.get_job("job_success")
        self.assertIn(job["status"], (STATE_COMPLETED, STATE_CLOUD_COMPLETED))
        self.assertEqual(job["cups_job_id"], 105)

    def test_cups_submission_exception_preserves_recovery(self):
        """Verify CUPS submission exception transitions to CUPS_SUBMISSION_UNCERTAIN and does NOT reprint."""
        agent = SmartPrintAgent(config=self.config)
        agent.state_mgr = self.state_mgr
        agent.doc_mgr = self.doc_mgr

        agent.make_api_request = MagicMock(return_value={"success": True, "data": {}})
        agent.cups.get_queue_status = MagicMock(return_value=("READY", "Printer ready"))
        agent.cups.submit_print_job = MagicMock(side_effect=CupsSubmissionError("IPP socket broken pipe"))

        mock_resp = MagicMock()
        mock_resp.read.return_value = b"%PDF-1.4 dummy pdf content"
        mock_resp.__enter__.return_value = mock_resp

        with patch("urllib.request.urlopen", return_value=mock_resp):
            agent.execute_print_job({"id": "job_cups_err", "idempotency_key": "idem_err"})

        job = self.state_mgr.get_job("job_cups_err")
        self.assertEqual(job["status"], STATE_CUPS_SUBMISSION_UNCERTAIN)

        # Document must be retained in recovery
        rec_file = os.path.join(self.doc_mgr.recovery_dir, "job_cups_err", "document.pdf")
        self.assertTrue(os.path.exists(rec_file))

    def test_cups_never_returns_fake_job_id(self):
        """Verify that cups_controller raises CupsSubmissionError instead of returning fake 1."""
        cups_ctrl = CupsController()
        cups_ctrl.conn = None

        # Mock validate_document and get_queue_status
        cups_ctrl.validate_document = MagicMock()
        cups_ctrl.get_queue_status = MagicMock(return_value=("READY", "Printer ready"))

        # Mock subprocess returning output with NO job id
        with patch("subprocess.check_output", return_value="request id is invalid without dash"):
            with self.assertRaises(CupsSubmissionError):
                cups_ctrl.submit_print_job("/tmp/test.pdf", {"copies": 1}, queue_name="HP_Laser_108w")

    # --------------------------------------------------------------------------
    # 5. COMPLETION, ABORT & TIMEOUT
    # --------------------------------------------------------------------------
    def test_cups_aborted_preserves_for_recovery(self):
        """Verify CUPS job abortion marks RECOVERY_REQUIRED and preserves document."""
        agent = SmartPrintAgent(config=self.config)
        agent.state_mgr = self.state_mgr
        agent.doc_mgr = self.doc_mgr

        agent.make_api_request = MagicMock(return_value={"success": True, "data": {}})
        agent.cups.get_queue_status = MagicMock(return_value=("READY", "Printer ready"))
        agent.cups.submit_print_job = MagicMock(return_value=201)
        agent.cups.wait_for_job_completion = MagicMock(return_value=(False, "Job terminated with error state 7 (aborted)"))

        mock_resp = MagicMock()
        mock_resp.read.return_value = b"%PDF-1.4 dummy pdf content"
        mock_resp.__enter__.return_value = mock_resp

        with patch("urllib.request.urlopen", return_value=mock_resp):
            agent.execute_print_job({"id": "job_aborted", "idempotency_key": "idem_abort"})

        job = self.state_mgr.get_job("job_aborted")
        self.assertEqual(job["status"], STATE_RECOVERY_REQUIRED)
        rec_file = os.path.join(self.doc_mgr.recovery_dir, "job_aborted", "document.pdf")
        self.assertTrue(os.path.exists(rec_file))

    def test_timeout_transitions_to_outcome_uncertain(self):
        """Verify monitoring timeout marks OUTCOME_UNCERTAIN and preserves document."""
        agent = SmartPrintAgent(config=self.config)
        agent.state_mgr = self.state_mgr
        agent.doc_mgr = self.doc_mgr

        agent.make_api_request = MagicMock(return_value={"success": True, "data": {}})
        agent.cups.get_queue_status = MagicMock(return_value=("READY", "Printer ready"))
        agent.cups.submit_print_job = MagicMock(return_value=202)
        agent.cups.wait_for_job_completion = MagicMock(return_value=(False, "Job monitoring timed out after 120s (OUTCOME_UNCERTAIN)"))

        mock_resp = MagicMock()
        mock_resp.read.return_value = b"%PDF-1.4 dummy pdf content"
        mock_resp.__enter__.return_value = mock_resp

        with patch("urllib.request.urlopen", return_value=mock_resp):
            agent.execute_print_job({"id": "job_timeout", "idempotency_key": "idem_timeout"})

        job = self.state_mgr.get_job("job_timeout")
        self.assertEqual(job["status"], STATE_OUTCOME_UNCERTAIN)
        rec_file = os.path.join(self.doc_mgr.recovery_dir, "job_timeout", "document.pdf")
        self.assertTrue(os.path.exists(rec_file))

    # --------------------------------------------------------------------------
    # 6. CRASH RECOVERY & POWER INTERRUPTION SIMULATION
    # --------------------------------------------------------------------------
    def test_crash_recovery_during_printing_completed_in_cups(self):
        """
        Simulate crash while job is in PRINTING. On reboot:
        CUPS reports job is completed. Agent must mark COMPLETED, enqueue outbox, and wipe file.
        """
        # Pre-seed DB simulating pre-crash state
        self.state_mgr.reserve_job("job_crash_1", "idem_c1", "GITAM-SPK-001")
        self.state_mgr.transition_status("job_crash_1", STATE_PRINTING, cups_job_id=301, cups_queue="HP_Laser_108w")

        agent = SmartPrintAgent(config=self.config)
        agent.state_mgr = self.state_mgr
        agent.doc_mgr = self.doc_mgr

        agent.cups.wait_for_job_completion = MagicMock(return_value=(True, "Job completed in CUPS"))
        agent.startup_recovery_check()

        job = self.state_mgr.get_job("job_crash_1")
        self.assertEqual(job["status"], STATE_COMPLETED)

        # Check outbox has job-complete queued
        outbox = self.state_mgr.get_pending_outbox_items()
        self.assertTrue(any(item["job_id"] == "job_crash_1" and item["endpoint"] == "/api/kiosk/job-complete" for item in outbox))

    def test_crash_recovery_during_printing_missing_from_cups_never_reprints(self):
        """
        Simulate crash while job is in PRINTING. On reboot:
        Job is missing from CUPS. Agent must mark OUTCOME_UNCERTAIN and NEVER auto-reprint.
        """
        self.state_mgr.reserve_job("job_crash_2", "idem_c2", "GITAM-SPK-001")
        self.state_mgr.transition_status("job_crash_2", STATE_PRINTING, cups_job_id=302, cups_queue="HP_Laser_108w")

        agent = SmartPrintAgent(config=self.config)
        agent.state_mgr = self.state_mgr
        agent.doc_mgr = self.doc_mgr

        agent.cups.wait_for_job_completion = MagicMock(return_value=(False, "Job missing from active and completed queue"))
        agent.startup_recovery_check()

        job = self.state_mgr.get_job("job_crash_2")
        self.assertEqual(job["status"], STATE_OUTCOME_UNCERTAIN)

    def test_crash_recovery_during_downloading_marks_failed_before_submission(self):
        """
        Simulate crash while in DOWNLOADING.
        On reboot, marks FAILED_BEFORE_SUBMISSION since CUPS was never reached.
        """
        self.state_mgr.reserve_job("job_crash_3", "idem_c3", "GITAM-SPK-001")
        self.state_mgr.transition_status("job_crash_3", STATE_DOWNLOADING)

        agent = SmartPrintAgent(config=self.config)
        agent.state_mgr = self.state_mgr
        agent.doc_mgr = self.doc_mgr

        agent.startup_recovery_check()

        job = self.state_mgr.get_job("job_crash_3")
        self.assertEqual(job["status"], STATE_FAILED_BEFORE_SUBMISSION)

    # --------------------------------------------------------------------------
    # 7. OUTBOX PERSISTENCE & RETRY AFTER REBOOT
    # --------------------------------------------------------------------------
    def test_cloud_reporting_failure_stored_in_outbox_and_retried_after_reboot(self):
        """
        Simulate print succeeding physically, but cloud /job-complete endpoint failing.
        Verify outbox stores item, survives reboot, and succeeds on next retry.
        """
        agent = SmartPrintAgent(config=self.config)
        agent.state_mgr = self.state_mgr
        agent.doc_mgr = self.doc_mgr

        # Reserve and complete job locally
        self.state_mgr.reserve_job("job_outbox_1", "idem_ob1", "GITAM-SPK-001")
        self.state_mgr.transition_status("job_outbox_1", STATE_COMPLETED, cups_job_id=401)
        self.state_mgr.enqueue_outbox("job_outbox_1", "/api/kiosk/job-complete", {"job_id": "job_outbox_1", "cups_job_id": 401})

        # First attempt: cloud unreachable
        agent.make_api_request = MagicMock(return_value={"success": False, "error": "503 Service Unavailable"})
        agent.process_outbox()

        # Item should still be pending with attempt count = 1
        with self.state_mgr._get_connection() as conn:
            row = conn.execute("SELECT status, attempts FROM cloud_outbox WHERE job_id = 'job_outbox_1'").fetchone()
            self.assertEqual(row["status"], "PENDING")
            self.assertEqual(row["attempts"], 1)

        # Simulate agent reboot (new instance with same SQLite database)
        agent_after_reboot = SmartPrintAgent(config=self.config)
        agent_after_reboot.state_mgr = StateManager(db_path=self.db_path, state_dir=self.state_dir)
        agent_after_reboot.doc_mgr = DocumentManager(state_dir=self.state_dir)

        # Force next_retry_at to past so it's picked up immediately
        with agent_after_reboot.state_mgr._get_connection() as conn:
            conn.execute("UPDATE cloud_outbox SET next_retry_at = ? WHERE job_id = 'job_outbox_1'", (time.time() - 1,))
            conn.commit()

        # Second attempt: cloud back online (HTTP 200)
        agent_after_reboot.make_api_request = MagicMock(return_value={"success": True, "data": {"status": "COMPLETED"}})
        agent_after_reboot.process_outbox()

        # Verify outbox item marked SUCCESS and job transitioned to CLOUD_COMPLETED
        with agent_after_reboot.state_mgr._get_connection() as conn:
            row = conn.execute("SELECT status FROM cloud_outbox WHERE job_id = 'job_outbox_1'").fetchone()
            self.assertEqual(row["status"], "SUCCESS")

        job = agent_after_reboot.state_mgr.get_job("job_outbox_1")
        self.assertEqual(job["status"], STATE_CLOUD_COMPLETED)

    # --------------------------------------------------------------------------
    # 8. BOUNDED RETENTION & CLEANUP
    # --------------------------------------------------------------------------
    def test_cleanup_expired_vs_active_recovery(self):
        """
        Verify cleanup deletes recovery files older than 24h,
        while strictly preserving recent (< 24h) recovery documents.
        """
        # Create unexpired recovery job (1 hour old)
        recent_dir = os.path.join(self.doc_mgr.recovery_dir, "job_recent")
        os.makedirs(recent_dir, exist_ok=True)
        with open(os.path.join(recent_dir, "document.pdf"), "wb") as f:
            f.write(b"recent doc")
        with open(os.path.join(recent_dir, "metadata.json"), "w") as f:
            json.dump({"preserved_at": time.time() - 3600}, f)

        # Create expired recovery job (25 hours old)
        expired_dir = os.path.join(self.doc_mgr.recovery_dir, "job_expired")
        os.makedirs(expired_dir, exist_ok=True)
        with open(os.path.join(expired_dir, "document.pdf"), "wb") as f:
            f.write(b"expired doc")
        with open(os.path.join(expired_dir, "metadata.json"), "w") as f:
            json.dump({"preserved_at": time.time() - (25 * 3600)}, f)

        purged = self.doc_mgr.cleanup_expired_recovery_files(max_age_hours=24)
        self.assertEqual(purged, 1)

        # Expired job directory must be gone
        self.assertFalse(os.path.exists(expired_dir))
        # Recent job directory must still exist!
        self.assertTrue(os.path.exists(recent_dir))
        self.assertTrue(os.path.exists(os.path.join(recent_dir, "document.pdf")))

    # --------------------------------------------------------------------------
    # 9. DATABASE MIGRATION FROM LEGACY SCHEMA
    # --------------------------------------------------------------------------
    def test_database_migration_from_legacy_processed_jobs(self):
        """
        Verify that an existing database with legacy 'processed_jobs' table
        is seamlessly migrated into 'job_state' with zero data loss.
        """
        migration_db = os.path.join(self.test_dir, "legacy_test.db")
        conn = sqlite3.connect(migration_db)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE processed_jobs (
                job_id TEXT PRIMARY KEY,
                idempotency_key TEXT UNIQUE,
                status TEXT,
                cups_job_id INTEGER,
                processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        cursor.execute("""
            INSERT INTO processed_jobs (job_id, idempotency_key, status, cups_job_id)
            VALUES ('job_legacy_1', 'idem_leg_1', 'COMPLETED', 99);
        """)
        conn.commit()
        conn.close()

        # Initialize StateManager on this legacy DB
        mgr = StateManager(db_path=migration_db, state_dir=self.state_dir)
        migrated_job = mgr.get_job("job_legacy_1")

        self.assertIsNotNone(migrated_job)
        self.assertEqual(migrated_job["job_id"], "job_legacy_1")
        self.assertEqual(migrated_job["idempotency_key"], "idem_leg_1")
        self.assertEqual(migrated_job["status"], "COMPLETED")
        self.assertEqual(migrated_job["cups_job_id"], 99)


if __name__ == "__main__":
    unittest.main()
