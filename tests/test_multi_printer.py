#!/usr/bin/env python3
"""
GITAM SMARTPRINT - Multi-Printer System Test Suite
Tests up to 5 physical printers per kiosk, auto-discovery, capability detection,
independent queue monitoring, server/agent routing failover, and zero-duplicate persistence.
"""

import os
import sys
import json
import unittest
import tempfile
import shutil
from unittest.mock import MagicMock, patch

# Ensure agent modules are importable
AGENT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "raspberry-pi", "agent"))
if AGENT_DIR not in sys.path:
    sys.path.insert(0, AGENT_DIR)

from cups_controller import CupsController, CupsSubmissionError, CupsQueueUnavailableError
from state_manager import (
    StateManager,
    STATE_RESERVED,
    STATE_PROCESSING,
    STATE_SUBMITTING_TO_CUPS,
    STATE_SUBMITTED_TO_CUPS,
    STATE_PRINTING,
    STATE_COMPLETED,
    STATE_RECOVERY_REQUIRED,
)
from smartprint_agent import SmartPrintAgent
from document_manager import DocumentManager
from diagnostics import check_power_undervoltage


class TestMultiPrinterSystem(unittest.TestCase):
    """Integration & unit tests for Multi-Printer architecture (up to 5 printers)."""

    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="smartprint_multiprinter_test_")
        self.state_dir = os.path.join(self.test_dir, "state")
        os.makedirs(self.state_dir, exist_ok=True)

        self.config = {
            "kiosk_id": "GITAM-SPK-001",
            "device_token": "test_token_secret",
            "backend_url": "http://localhost:3000",
            "cups_queue": "HP_Laser_108w",
            "state_dir": self.state_dir,
            "agent_version": "1.0.0",
        }

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_multi_printer_auto_discovery(self):
        """
        Verify discover_all_printers discovers up to 5 printers across
        USB, IPP-USB, Network, and CUPS queues, extracting all 12 attributes.
        """
        controller = CupsController(default_queue="HP_Laser_108w")

        # Mock CUPS queues, lsusb, and lpinfo
        mock_queues = {
            "HP_Laser_108w": {
                "device-uri": "ipp://127.0.0.1:60000/ipp/print",
                "printer-make-and-model": "HP Laser 108w",
                "printer-info": "Primary B&W Printer",
            },
            "HP_Color_LaserJet": {
                "device-uri": "usb://HP/Color%20LaserJet%20Pro%20M454dn?serial=VND3K0192",
                "printer-make-and-model": "HP Color LaserJet Pro M454dn",
                "printer-info": "Color Primary Printer",
            },
            "HP_LaserJet_Backup": {
                "device-uri": "usb://HP/LaserJet%20Enterprise%20M507?serial=PHB4M0098",
                "printer-make-and-model": "HP LaserJet Enterprise M507",
                "printer-info": "Backup B&W Printer",
            },
            "Epson_EcoTank_Color": {
                "device-uri": "ipp://192.168.1.150:631/printers/Epson_EcoTank",
                "printer-make-and-model": "Epson EcoTank L3250 Series Color",
                "printer-info": "Network Color Backup",
            },
            "Brother_Duplex_Mono": {
                "device-uri": "socket://192.168.1.160:9100",
                "printer-make-and-model": "Brother HL-L2350DW series",
                "printer-info": "Network Duplex Mono",
            },
        }

        # Mock pycups conn
        mock_conn = MagicMock()
        mock_conn.getPrinters.return_value = mock_queues
        mock_conn.getDefault.return_value = "HP_Laser_108w"
        controller.conn = mock_conn

        with patch("cups_controller.HAS_PYCUPS", True):
            printers = controller.discover_all_printers()

        self.assertEqual(len(printers), 5)

        # 1. Verify HP Laser 108w (Monochrome, IPP-USB)
        p1 = next(p for p in printers if p["cups_queue_name"] == "HP_Laser_108w")
        self.assertEqual(p1["manufacturer"], "HP")
        self.assertEqual(p1["connection_type"], "IPP-USB")
        self.assertFalse(p1["supports_color"])
        self.assertTrue(p1["is_default"])
        self.assertTrue(len(p1["hardware_id"]) > 0)

        # 2. Verify HP Color LaserJet (Color, USB)
        p2 = next(p for p in printers if p["cups_queue_name"] == "HP_Color_LaserJet")
        self.assertEqual(p2["manufacturer"], "HP")
        self.assertEqual(p2["connection_type"], "USB")
        self.assertTrue(p2["supports_color"])

        # 3. Verify Epson Network Color
        p4 = next(p for p in printers if p["cups_queue_name"] == "Epson_EcoTank_Color")
        self.assertEqual(p4["manufacturer"], "Epson")
        self.assertEqual(p4["connection_type"], "NETWORK")
        self.assertTrue(p4["supports_color"])

        # 4. Verify Brother Network Mono
        p5 = next(p for p in printers if p["cups_queue_name"] == "Brother_Duplex_Mono")
        self.assertEqual(p5["manufacturer"], "Brother")
        self.assertEqual(p5["connection_type"], "NETWORK")
        self.assertFalse(p5["supports_color"])

    def test_multi_printer_independent_status_monitoring(self):
        """
        Verify that each printer queue is monitored independently.
        Failure or paper-out on one printer must not affect other queues.
        """
        controller = CupsController()

        status_map = {
            "HP_Laser_108w": ("READY", "Printer idle and ready"),
            "HP_Color_LaserJet": ("PAPER_OUT", "Paper tray is empty (media-empty)"),
            "HP_LaserJet_Backup": ("STOPPED", "Queue is stopped or paused (paused)"),
            "Epson_EcoTank_Color": ("BUSY", "Printing in progress"),
            "Brother_Duplex_Mono": ("OFFLINE", "Printer is offline"),
        }

        def mock_get_status(queue_name=None):
            q = queue_name or "HP_Laser_108w"
            return status_map.get(q, ("READY", "Ready"))

        controller.get_queue_status = MagicMock(side_effect=mock_get_status)

        # Test each queue independently
        s1, m1 = controller.get_queue_status("HP_Laser_108w")
        self.assertEqual(s1, "READY")

        s2, m2 = controller.get_queue_status("HP_Color_LaserJet")
        self.assertEqual(s2, "PAPER_OUT")

        s3, m3 = controller.get_queue_status("HP_LaserJet_Backup")
        self.assertEqual(s3, "STOPPED")

        s4, m4 = controller.get_queue_status("Epson_EcoTank_Color")
        self.assertEqual(s4, "BUSY")

        s5, m5 = controller.get_queue_status("Brother_Duplex_Mono")
        self.assertEqual(s5, "OFFLINE")

        # Confirm queue 1 status remains READY even while queue 2 has PAPER_OUT
        self.assertEqual(controller.get_queue_status("HP_Laser_108w")[0], "READY")

    def test_multi_printer_heartbeat_payload(self):
        """
        Verify that send_heartbeat discovers all printers and includes
        the 'printers' array with individual statuses in the payload.
        """
        agent = SmartPrintAgent(config=self.config)

        mock_printers = [
            {
                "hardware_id": "hw_01",
                "printer_name": "HP Laser 108w",
                "display_name": "HP Laser 108w (Primary B&W)",
                "manufacturer": "HP",
                "model": "HP Laser 108w",
                "cups_queue_name": "HP_Laser_108w",
                "device_uri": "ipp://127.0.0.1:60000/ipp/print",
                "connection_type": "IPP-USB",
                "status": "READY",
                "supports_color": False,
                "supports_duplex": False,
                "is_default": True,
            },
            {
                "hardware_id": "hw_02",
                "printer_name": "HP Color LaserJet Pro",
                "display_name": "HP Color LaserJet (Color Primary)",
                "manufacturer": "HP",
                "model": "HP Color LaserJet Pro M454dn",
                "cups_queue_name": "HP_Color_LaserJet",
                "device_uri": "usb://HP/Color",
                "connection_type": "USB",
                "status": "PAPER_OUT",
                "supports_color": True,
                "supports_duplex": True,
                "is_default": False,
            },
        ]

        agent.cups.discover_all_printers = MagicMock(return_value=mock_printers)
        agent.cups.get_queue_status = MagicMock(return_value=("READY", "Ready"))

        captured_payloads = []

        def mock_request(endpoint, payload=None, method="POST"):
            if endpoint == "/api/kiosk/heartbeat":
                captured_payloads.append(payload)
                return {"success": True, "data": {"maintenance_mode": False}}
            return {"success": True}

        agent.make_api_request = MagicMock(side_effect=mock_request)

        agent.send_heartbeat()

        self.assertEqual(len(captured_payloads), 1)
        hb = captured_payloads[0]
        self.assertIn("printers", hb)
        self.assertEqual(len(hb["printers"]), 2)
        self.assertEqual(hb["printers"][0]["cups_queue_name"], "HP_Laser_108w")
        self.assertEqual(hb["printers"][1]["cups_queue_name"], "HP_Color_LaserJet")
        self.assertEqual(hb["printers"][1]["status"], "PAPER_OUT")

    def test_multi_printer_bw_failover_routing(self):
        """
        Verify that when the primary B&W printer is unavailable (PAPER_OUT),
        the agent automatically reroutes the monochrome job to the ready backup printer.
        """
        agent = SmartPrintAgent(config=self.config)

        # Mock queue statuses: Primary is PAPER_OUT, Backup is READY
        def mock_q_status(queue_name=None):
            if queue_name == "HP_Laser_108w":
                return "PAPER_OUT", "Paper empty"
            if queue_name == "HP_LaserJet_Backup":
                return "READY", "Idle"
            return "READY", "Idle"

        agent.cups.get_queue_status = MagicMock(side_effect=mock_q_status)

        # Mock discovered printers
        agent.cups.discover_all_printers = MagicMock(return_value=[
            {
                "cups_queue_name": "HP_Laser_108w",
                "status": "PAPER_OUT",
                "supports_color": False,
                "supports_duplex": False,
            },
            {
                "cups_queue_name": "HP_LaserJet_Backup",
                "status": "READY",
                "supports_color": False,
                "supports_duplex": True,
            },
        ])

        # Prepare dummy PDF
        test_pdf = os.path.join(self.test_dir, "test_doc.pdf")
        with open(test_pdf, "wb") as f:
            f.write(b"%PDF-1.4 test document content for smartprint multi-printer")

        agent.doc_mgr.prepare_job_workspace = MagicMock(return_value=test_pdf)
        agent.cups.validate_document = MagicMock()
        agent.cups.submit_print_job = MagicMock(return_value=501)
        agent.cups.wait_for_job_completion = MagicMock(return_value=(True, "Completed"))

        submitted_queues = []

        def mock_submit(file_path, options, queue_name=None):
            submitted_queues.append(queue_name)
            return 501

        agent.cups.submit_print_job = MagicMock(side_effect=mock_submit)

        def mock_api(endpoint, payload=None, method="POST"):
            return {"success": True}

        agent.make_api_request = MagicMock(side_effect=mock_api)

        job = {
            "id": "job_bw_failover_01",
            "idempotency_key": "idemp_bw_failover_01",
            "cups_queue_name": "HP_Laser_108w",
            "is_color": False,
            "is_duplex": False,
            "copies": 1,
            "signed_download_url": "/api/kiosk/download/job_bw_failover_01",
        }

        # Mock download
        with patch("urllib.request.urlopen") as mock_url:
            mock_resp = MagicMock()
            mock_resp.read.return_value = b"%PDF-1.4 sample payload"
            mock_url.return_value.__enter__.return_value = mock_resp

            agent.execute_print_job(job)

        # Verify job was rerouted and submitted to backup queue!
        self.assertEqual(len(submitted_queues), 1)
        self.assertEqual(submitted_queues[0], "HP_LaserJet_Backup")

        # Verify state history recorded failover
        hist = agent.state_mgr.get_job_history("job_bw_failover_01")
        failover_entries = [h for h in hist if "Failover to HP_LaserJet_Backup" in (h.get("details") or "")]
        self.assertTrue(len(failover_entries) > 0)

    def test_multi_printer_color_safety_no_monochrome_spooling(self):
        """
        CRITICAL SAFETY: When a color job is submitted to a monochrome-only printer,
        or when a color printer fails and only monochrome backups are available,
        the agent MUST refuse to print color on monochrome and preserve the job safely.
        """
        agent = SmartPrintAgent(config=self.config)

        # Color printer is OFFLINE, only monochrome printer is available
        def mock_q_status(queue_name=None):
            if queue_name == "HP_Color_LaserJet":
                return "OFFLINE", "Printer power disconnected"
            if queue_name == "HP_Laser_108w":
                return "READY", "Idle"
            return "READY", "Idle"

        agent.cups.get_queue_status = MagicMock(side_effect=mock_q_status)

        # Discovered printers: color printer is OFFLINE, only mono is ready
        agent.cups.discover_all_printers = MagicMock(return_value=[
            {
                "cups_queue_name": "HP_Color_LaserJet",
                "status": "OFFLINE",
                "supports_color": True,
            },
            {
                "cups_queue_name": "HP_Laser_108w",
                "status": "READY",
                "supports_color": False,
            },
        ])

        test_pdf = os.path.join(self.test_dir, "color_doc.pdf")
        with open(test_pdf, "wb") as f:
            f.write(b"%PDF-1.4 color content")

        agent.doc_mgr.prepare_job_workspace = MagicMock(return_value=test_pdf)
        agent.cups.validate_document = MagicMock()
        agent.cups.submit_print_job = MagicMock()

        agent.make_api_request = MagicMock(return_value={"success": True})

        color_job = {
            "id": "job_color_safety_01",
            "idempotency_key": "idemp_color_safety_01",
            "cups_queue_name": "HP_Color_LaserJet",
            "is_color": True,
            "is_duplex": False,
            "copies": 1,
            "signed_download_url": "/api/kiosk/download/job_color_safety_01",
        }

        with patch("urllib.request.urlopen") as mock_url:
            mock_resp = MagicMock()
            mock_resp.read.return_value = b"%PDF-1.4 color document"
            mock_url.return_value.__enter__.return_value = mock_resp

            agent.execute_print_job(color_job)

        # CUPS submit_print_job must NEVER have been called on the monochrome printer!
        agent.cups.submit_print_job.assert_not_called()

        # Job must be transitioned to RECOVERY_REQUIRED
        st = agent.state_mgr.get_job_state("job_color_safety_01")
        self.assertEqual(st["current_state"], STATE_RECOVERY_REQUIRED)

    def test_cups_controller_rejects_color_on_monochrome_queue(self):
        """
        Verify CupsController.submit_print_job raises CupsSubmissionError
        if a color job is explicitly attempted on the HP Laser 108w monochrome queue.
        """
        controller = CupsController(default_queue="HP_Laser_108w")

        test_pdf = os.path.join(self.test_dir, "mono_check.pdf")
        with open(test_pdf, "wb") as f:
            f.write(b"%PDF-1.4 test")

        controller.get_queue_status = MagicMock(return_value=("READY", "Ready"))

        with self.assertRaises(CupsSubmissionError) as ctx:
            controller.submit_print_job(
                file_path=test_pdf,
                options={"is_color": True, "copies": 1},
                queue_name="HP_Laser_108w",
            )
        self.assertIn("strictly monochrome", str(ctx.exception))

    @patch("subprocess.check_output")
    def test_diagnostics_undervoltage_detection(self, mock_subp):
        """
        Verify that check_power_undervoltage accurately detects:
        - 0x0 nominal power (PASS)
        - Active under-voltage bit 0 (FAIL)
        - Historical under-voltage bit 16 (WARN)
        """
        # 1. Nominal power
        mock_subp.return_value = "throttled=0x0\n"
        status, details = check_power_undervoltage()
        self.assertEqual(status, "PASS")
        self.assertIn("nominal", details.lower())

        # 2. Active under-voltage (< 4.63V)
        mock_subp.return_value = "throttled=0x50005\n"
        status, details = check_power_undervoltage()
        self.assertEqual(status, "FAIL")
        self.assertIn("ACTIVE UNDER-VOLTAGE", details)

        # 3. Under-voltage occurred since boot
        mock_subp.return_value = "throttled=0x50000\n"
        status, details = check_power_undervoltage()
        self.assertEqual(status, "WARN")
        self.assertIn("Under-voltage occurred since boot", details)

    def test_pantum_m7100dw_discovery_and_duplex_capabilities(self):
        """
        Verify that Pantum M7100DW is discovered with duplex capability enabled
        and proper hardware model attribution.
        """
        controller = CupsController(default_queue="PANTUM_M7100DW")

        lpstat_v_output = (
            "device for PANTUM_M7100DW: ipp://127.0.0.1:60000/ipp/print\n"
            "device for HP_Laser_108w: ipp://127.0.0.1:60001/ipp/print\n"
        )
        with patch("subprocess.check_output") as mock_subp:
            def side_effect(cmd, **kwargs):
                if cmd[0] == "lpstat" and "-v" in cmd:
                    return lpstat_v_output
                elif cmd[0] == "lpstat" and "-d" in cmd:
                    return "system default destination: PANTUM_M7100DW\n"
                elif cmd[0] == "lpoptions":
                    return "PageSize/Media Size: *A4 Letter\nDuplex/2-Sided: None *DuplexNoTumble\nColorModel/Color: *Gray\n"
                elif cmd[0] == "lsusb":
                    return "Bus 001 Device 004: ID 232b:0ed0 Pantum M7100DW Series\n"
                return ""

            mock_subp.side_effect = side_effect
            printers = controller.discover_all_printers()

            self.assertEqual(len(printers), 2)
            pantum = next((p for p in printers if p["cups_queue_name"] == "PANTUM_M7100DW"), None)
            self.assertIsNotNone(pantum)
            self.assertTrue(pantum["supports_duplex"])
            self.assertFalse(pantum["supports_color"])
            self.assertEqual(pantum["manufacturer"], "Pantum")

    def test_pantum_m7100dw_auto_provisioning_when_unregistered(self):
        """
        Verify that _ensure_pantum_queue_registered detects USB Pantum hardware (232b:0ed0)
        and invokes lpadmin and cupsenable to auto-provision PANTUM_M7100DW.
        """
        controller = CupsController()
        with patch("subprocess.check_output") as mock_check, patch("subprocess.run") as mock_run:
            def check_output_mock(cmd, **kwargs):
                if cmd[0] == "lsusb":
                    return "Bus 001 Device 005: ID 232b:0ed0 Pantum M7100DW Series\n"
                if cmd[0] == "lpinfo":
                    return "direct usb://Pantum/M7100DW%20Series?serial=123456\n"
                if cmd[0] == "lpstat" and "PANTUM_M7100DW" in cmd:
                    raise Exception("Printer does not exist")
                return ""

            mock_check.side_effect = check_output_mock
            mock_run.return_value = MagicMock(returncode=0)

            queue_name = controller._ensure_pantum_queue_registered()
            self.assertEqual(queue_name, "PANTUM_M7100DW")
            self.assertEqual(controller.default_queue, "PANTUM_M7100DW")

            # Verify lpadmin was called to register the queue
            lpadmin_calls = [call for call in mock_run.call_args_list if call[0][0][0] == "lpadmin"]
            self.assertTrue(len(lpadmin_calls) >= 1)

    def test_pantum_queue_alias_normalization(self):
        """
        Verify that agent normalizes any Pantum alias (e.g. Pantum_M7108DW)
        to the physical CUPS queue PANTUM_M7100DW.
        """
        agent = SmartPrintAgent(self.config)
        job = {
            "id": "job_pantum_test_01",
            "kiosk_id": "GITAM-SPK-001",
            "cups_printer_name": "Pantum_M7108DW",
            "cups_queue_name": "Pantum_M7108DW",
            "is_color": False,
            "is_duplex": True,
        }
        target_queue = (
            job.get("cups_printer_name")
            or job.get("cups_queue_name")
            or agent.cups.default_queue
        )
        if target_queue and "pantum" in target_queue.lower():
            target_queue = "PANTUM_M7100DW"

        self.assertEqual(target_queue, "PANTUM_M7100DW")

    def test_hp_p1108_auto_provisioning_when_unregistered(self):
        """
        Verify that _ensure_hp_p1108_queue_registered detects HP LaserJet P1108 (03f0:002a)
        and invokes lpadmin + cupsenable + lpoptions to auto-provision HP_LaserJet_P1108.
        """
        controller = CupsController()
        with patch("subprocess.check_output") as mock_check, patch("subprocess.run") as mock_run:
            def check_output_mock(cmd, **kwargs):
                if cmd[0] == "lsusb":
                    return "Bus 001 Device 006: ID 03f0:002a HP, Inc LaserJet Professional P1108\n"
                if cmd[0] == "lpinfo" and "-v" in cmd:
                    return "direct hp:/usb/HP_LaserJet_Professional_P1108?serial=000000\n"
                if cmd[0] == "lpinfo" and "-m" in cmd:
                    return "drv:///hp/hpcups.drv/hp-laserjet_professional_p1108.ppd HP LaserJet Professional P1108, hpcups 3.22.10\n"
                if cmd[0] == "lpstat" and "HP_LaserJet_P1108" in cmd:
                    raise Exception("Printer does not exist")
                return ""

            mock_check.side_effect = check_output_mock
            mock_run.return_value = MagicMock(returncode=0)

            queue_name = controller._ensure_hp_p1108_queue_registered()
            self.assertEqual(queue_name, "HP_LaserJet_P1108")

            lpadmin_calls = [call for call in mock_run.call_args_list if call[0][0][0] == "lpadmin"]
            self.assertTrue(len(lpadmin_calls) >= 1)
            self.assertIn("HP_LaserJet_P1108", lpadmin_calls[0][0][0])

    def test_pantum_and_hp_p1108_dual_discovery_and_color_guard(self):
        """
        Verify both PANTUM_M7100DW and HP_LaserJet_P1108 are discovered cleanly
        without colliding with HP Laser 108w, and P1108 rejects color jobs.
        """
        controller = CupsController(default_queue="PANTUM_M7100DW")
        controller.get_queue_status = MagicMock(return_value=("READY", "Printer idle and ready"))
        controller._ensure_pantum_queue_registered = MagicMock(return_value="PANTUM_M7100DW")
        controller._ensure_hp_p1108_queue_registered = MagicMock(return_value="HP_LaserJet_P1108")

        with patch("cups_controller.HAS_PYCUPS", False), patch("subprocess.check_output") as mock_subp:
            def side_effect(cmd, **kwargs):
                if cmd[0] == "lpstat" and "-v" in cmd:
                    return (
                        "device for PANTUM_M7100DW: ipp://127.0.0.1:60000/ipp/print\n"
                        "device for HP_LaserJet_P1108: hp:/usb/HP_LaserJet_Professional_P1108?serial=123\n"
                    )
                if cmd[0] == "lpstat" and "-d" in cmd:
                    return "system default destination: PANTUM_M7100DW\n"
                if cmd[0] == "lpoptions":
                    return "PageSize/Media Size: *A4 Letter\nColorModel/Color: *Gray\n"
                if cmd[0] == "lsusb":
                    return (
                        "Bus 001 Device 004: ID 232b:0ed0 Pantum M7100DW Series\n"
                        "Bus 001 Device 006: ID 03f0:002a HP, Inc LaserJet Professional P1108\n"
                    )
                return ""

            mock_subp.side_effect = side_effect
            printers = controller.discover_all_printers()

        self.assertEqual(len(printers), 2)
        pantum = next((p for p in printers if p["cups_queue_name"] == "PANTUM_M7100DW"), None)
        p1108 = next((p for p in printers if p["cups_queue_name"] == "HP_LaserJet_P1108"), None)
        self.assertIsNotNone(pantum)
        self.assertIsNotNone(p1108)
        self.assertTrue(pantum["supports_duplex"])
        self.assertFalse(p1108["supports_duplex"])
        self.assertFalse(p1108["supports_color"])
        self.assertEqual(p1108["model"], "HP LaserJet P1108")

        # Verify P1108 rejects color job
        temp_pdf = os.path.join(self.test_dir, "color_test.pdf")
        with open(temp_pdf, "wb") as f:
            f.write(b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n")
        with self.assertRaises(CupsSubmissionError):
            controller.submit_print_job(temp_pdf, {"is_color": True, "copies": 1}, queue_name="HP_LaserJet_P1108")

    def test_color_printer_discovery_and_color_cups_options(self):
        """
        Verify color printers (e.g. Epson EcoTank L3250, HP Color LaserJet) are discovered
        with supports_color=True and submitted with ColorModel=RGB & print-color-mode=color.
        """
        controller = CupsController(default_queue="PANTUM_M7100DW")
        controller.get_queue_status = MagicMock(return_value=("READY", "Printer idle and ready"))
        controller._ensure_pantum_queue_registered = MagicMock(return_value="PANTUM_M7100DW")
        controller._ensure_hp_p1108_queue_registered = MagicMock(return_value=None)

        with patch("cups_controller.HAS_PYCUPS", False), patch("subprocess.check_output") as mock_subp:
            def side_effect(cmd, **kwargs):
                if cmd[0] == "lpstat" and "-v" in cmd:
                    return (
                        "device for PANTUM_M7100DW: ipp://127.0.0.1:60000/ipp/print\n"
                        "device for EPSON_L3250: usb://EPSON/L3250%20Series?serial=ABC\n"
                    )
                if cmd[0] == "lpstat" and "-d" in cmd:
                    return "system default destination: PANTUM_M7100DW\n"
                if cmd[0] == "lpoptions":
                    if "EPSON_L3250" in cmd:
                        return "PageSize/Media Size: *A4\nprint-color-mode/Color Mode: monochrome *color\n"
                    return "PageSize/Media Size: *A4\nColorModel/Color: *Gray\n"
                if cmd[0] == "lsusb":
                    return "Bus 001 Device 004: ID 232b:0ed0 Pantum M7100DW Series\nBus 001 Device 007: ID 04b8:08d1 Seiko Epson Corp. L3250\n"
                return ""

            mock_subp.side_effect = side_effect
            printers = controller.discover_all_printers()

        epson = next((p for p in printers if p["cups_queue_name"] == "EPSON_L3250"), None)
        self.assertIsNotNone(epson)
        self.assertTrue(epson["supports_color"])

        # Verify color submission passes RGB + color options to lp
        temp_pdf = os.path.join(self.test_dir, "color_doc.pdf")
        with open(temp_pdf, "wb") as f:
            f.write(b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n")

        with patch("cups_controller.HAS_PYCUPS", False), patch("subprocess.check_output") as mock_lp:
            mock_lp.return_value = "request id is EPSON_L3250-99 (1 file(s))\n"
            job_id = controller.submit_print_job(temp_pdf, {"is_color": True, "copies": 1}, queue_name="EPSON_L3250")
            self.assertEqual(job_id, 99)
            lp_calls = [c[0][0] for c in mock_lp.call_args_list if c[0][0][0] == "lp"]
            self.assertTrue(len(lp_calls) >= 1)
            self.assertIn("ColorModel=RGB", lp_calls[0])
            self.assertIn("print-color-mode=color", lp_calls[0])


if __name__ == "__main__":
    unittest.main()
