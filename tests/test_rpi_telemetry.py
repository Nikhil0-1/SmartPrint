#!/usr/bin/env python3
"""
Unit tests for Raspberry Pi hardware model detection, local IP discovery,
and authenticated heartbeat payload field inclusion.
"""
import unittest
from unittest.mock import patch, mock_open, MagicMock
import os
import sys

# Ensure raspberry-pi/agent is on sys.path
AGENT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "raspberry-pi", "agent"))
if AGENT_DIR not in sys.path:
    sys.path.insert(0, AGENT_DIR)

from smartprint_agent import get_hardware_model, get_local_ip, SmartPrintAgent


class TestRaspberryPiTelemetry(unittest.TestCase):

    @patch("os.path.exists")
    def test_get_hardware_model_device_tree(self, mock_exists):
        """Test model detection from /proc/device-tree/model with null byte removal."""
        def exists_side_effect(path):
            return path == "/proc/device-tree/model"
        mock_exists.side_effect = exists_side_effect

        mock_data = b"Raspberry Pi 4 Model B Rev 1.4\x00\n"
        with patch("builtins.open", mock_open(read_data=mock_data)):
            model = get_hardware_model()
            self.assertEqual(model, "Raspberry Pi 4 Model B Rev 1.4")

    @patch("os.path.exists")
    def test_get_hardware_model_null_byte_and_whitespace(self, mock_exists):
        """Test model strips trailing and leading spaces and null bytes."""
        def exists_side_effect(path):
            return path == "/proc/device-tree/model"
        mock_exists.side_effect = exists_side_effect

        mock_data = b"   Raspberry Pi 4 Model B Rev 1.4\x00   "
        with patch("builtins.open", mock_open(read_data=mock_data)):
            model = get_hardware_model()
            self.assertEqual(model, "Raspberry Pi 4 Model B Rev 1.4")

    @patch("os.path.exists")
    def test_get_hardware_model_cpuinfo_fallback(self, mock_exists):
        """Test fallback to /proc/cpuinfo when device-tree is absent."""
        def exists_side_effect(path):
            return path == "/proc/cpuinfo"
        mock_exists.side_effect = exists_side_effect

        cpuinfo_content = (
            "processor\t: 0\n"
            "BogoMIPS\t: 108.00\n"
            "Hardware\t: BCM2835\n"
            "Revision\t: c03114\n"
            "Model\t\t: Raspberry Pi 4 Model B Rev 1.4\n"
        )
        with patch("builtins.open", mock_open(read_data=cpuinfo_content)):
            model = get_hardware_model()
            self.assertEqual(model, "Raspberry Pi 4 Model B Rev 1.4")

    @patch.dict(os.environ, {"SMARTPRINT_HARDWARE_MODEL": "Raspberry Pi 4 Model B Override"}, clear=True)
    @patch("os.path.exists", return_value=False)
    def test_get_hardware_model_env_override(self, mock_exists):
        """Test fallback to environment variable when hardware files do not exist."""
        model = get_hardware_model()
        self.assertEqual(model, "Raspberry Pi 4 Model B Override")

    @patch.dict(os.environ, {}, clear=True)
    @patch("os.path.exists", return_value=False)
    def test_get_hardware_model_none(self, mock_exists):
        """Test returning None when no hardware model can be determined."""
        model = get_hardware_model()
        self.assertIsNone(model)

    @patch("socket.socket")
    def test_get_local_ip_socket_success(self, mock_socket_cls):
        """Test local IP detection via UDP socket query."""
        mock_s = MagicMock()
        mock_s.getsockname.return_value = ("192.168.1.105", 54321)
        mock_socket_cls.return_value = mock_s

        ip = get_local_ip()
        self.assertEqual(ip, "192.168.1.105")
        mock_s.connect.assert_called_with(("8.8.8.8", 80))
        mock_s.close.assert_called_once()

    @patch("socket.socket", side_effect=Exception("Network unreachable"))
    @patch("socket.gethostname", return_value="raspberrypi")
    @patch("socket.gethostbyname", return_value="10.0.0.42")
    def test_get_local_ip_fallback(self, mock_ghbn, mock_ghn, mock_sock):
        """Test local IP detection fallback via hostname resolution."""
        ip = get_local_ip()
        self.assertEqual(ip, "10.0.0.42")

    @patch("smartprint_agent.get_hardware_model", return_value="Raspberry Pi 4 Model B Rev 1.4")
    @patch("smartprint_agent.get_local_ip", return_value="192.168.1.105")
    @patch("smartprint_agent.get_system_telemetry", return_value=(45.5, 32.1, 15.4))
    def test_send_heartbeat_payload_fields(self, mock_telemetry, mock_ip, mock_model):
        """Test that send_heartbeat constructs and posts payload containing hardware_model and ip_address."""
        dummy_config = {
            "kiosk_id": "GITAM-SPK-001",
            "device_token": "valid_token_secret",
            "backend_url": "http://localhost:3000",
        }

        with patch("smartprint_agent.load_config", return_value=dummy_config), \
             patch("smartprint_agent.CupsController") as mock_cups_cls, \
             patch("smartprint_agent.init_local_db"), \
             patch("smartprint_agent.cleanup_stale_temp_files"):
            mock_cups = MagicMock()
            mock_cups.get_queue_status.return_value = ("READY", "Printer idle")
            mock_cups_cls.return_value = mock_cups

            agent = SmartPrintAgent()
            agent.make_api_request = MagicMock(return_value={"success": True, "data": {}})

            agent.send_heartbeat()

            agent.make_api_request.assert_called_once()
            call_args = agent.make_api_request.call_args
            endpoint = call_args[0][0]
            payload = call_args[1].get("payload") or call_args[0][1]

            self.assertEqual(endpoint, "/api/kiosk/heartbeat")
            self.assertEqual(payload.get("kiosk_id"), "GITAM-SPK-001")
            self.assertEqual(payload.get("hardware_model"), "Raspberry Pi 4 Model B Rev 1.4")
            self.assertEqual(payload.get("ip_address"), "192.168.1.105")
            self.assertEqual(payload.get("cpu_temp"), 45.5)
            self.assertEqual(payload.get("ram_usage"), 32.1)
            self.assertEqual(payload.get("disk_usage"), 15.4)
            self.assertEqual(payload.get("printer_status"), "READY")
            self.assertEqual(payload.get("printer_message"), "Printer idle")
            self.assertEqual(payload.get("agent_version"), "1.0.0")


if __name__ == "__main__":
    unittest.main()
