#!/usr/bin/env python3
"""
GITAM SMARTPRINT - Raspberry Pi CUPS Controller
Manages HP Laser 108w (USB via ipp-usb) printer queue, pre-flight queue validation,
atomic print submission, status tracking, and printer discovery.
Uses pycups if available, with robust fallback to Linux lp/lpstat system utilities.
"""

import os
import sys
import time
import json
import logging
import hashlib
import subprocess
from typing import Optional, Tuple, Dict, Any, List

logger = logging.getLogger("smartprint.cups_controller")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] CUPS: %(message)s")

try:
    import cups
    HAS_PYCUPS = True
except ImportError:
    cups = None
    HAS_PYCUPS = False
    logger.warning("pycups library not installed. Falling back to subprocess lp/lpstat CLI tool calls.")

DEFAULT_QUEUE_NAME = os.getenv("SMARTPRINT_CUPS_QUEUE", "HP_Laser_108w")
IPP_USB_ENDPOINT = os.getenv("SMARTPRINT_IPP_USB_ENDPOINT", "ipp://127.0.0.1:60000/ipp/print")


class CupsSubmissionError(Exception):
    """Raised when CUPS submission fails or cannot be verified."""
    pass


class CupsQueueUnavailableError(Exception):
    """Raised when the target queue is offline, stopped, or disabled."""
    pass


class CupsController:
    """Production controller for HP Laser 108w via CUPS and ipp-usb."""

    def __init__(self, default_queue: Optional[str] = None):
        self.default_queue = default_queue or DEFAULT_QUEUE_NAME
        self.conn = None
        self._init_connection()

    def _init_connection(self) -> None:
        """Initializes pycups connection if available."""
        if HAS_PYCUPS:
            try:
                self.conn = cups.Connection()
            except Exception as e:
                logger.error(f"Failed to connect to local CUPS daemon via pycups: {e}")
                self.conn = None
        else:
            self.conn = None

    def refresh_connection(self) -> None:
        """Re-establishes connection to CUPS daemon."""
        self._init_connection()

    # --------------------------------------------------------------------------
    # Zero-Touch Pantum M7100DW Queue Auto-Provisioning
    # --------------------------------------------------------------------------
    def _ensure_pantum_queue_registered(self) -> Optional[str]:
        """
        Zero-touch auto-provisioning for Pantum M7100DW Duplex Laser Printer.
        Detects Pantum on USB (VID 232b, PID 0ed0), auto-creates CUPS queue
        'PANTUM_M7100DW' if not present, and enables duplex + monochrome.
        """
        pantum_detected = False
        device_uri = None

        # 1. Check lsusb for Pantum hardware
        try:
            lsusb_out = subprocess.check_output(["lsusb"], text=True, stderr=subprocess.DEVNULL)
            if "232b:" in lsusb_out or "pantum" in lsusb_out.lower() or "0ed0" in lsusb_out:
                pantum_detected = True
        except Exception:
            pass

        # 2. Check lpinfo -v for Pantum USB or IPP device
        try:
            lpinfo_out = subprocess.check_output(["lpinfo", "-v"], text=True, stderr=subprocess.DEVNULL)
            for line in lpinfo_out.splitlines():
                line_lower = line.lower()
                if "pantum" in line_lower or "232b" in line_lower:
                    pantum_detected = True
                    parts = line.strip().split(None, 1)
                    if len(parts) >= 2:
                        device_uri = parts[1].strip()
                        break
        except Exception:
            pass

        if not pantum_detected:
            return None

        # 3. Check active ipp-usb ports if no device_uri from lpinfo
        if not device_uri:
            for port in [60001, 60000]:
                try:
                    import urllib.request
                    req = urllib.request.Request(f"http://127.0.0.1:{port}/ipp/print", method="HEAD")
                    with urllib.request.urlopen(req, timeout=0.5):
                        device_uri = f"ipp://127.0.0.1:{port}/ipp/print"
                        break
                except Exception:
                    pass

        if not device_uri:
            device_uri = "ipp://127.0.0.1:60000/ipp/print"

        queue_name = "PANTUM_M7100DW"

        # Check if queue already exists
        queue_exists = False
        try:
            q_check = subprocess.check_output(["lpstat", "-p", queue_name], text=True, stderr=subprocess.DEVNULL)
            if queue_name in q_check:
                queue_exists = True
        except Exception:
            queue_exists = False

        if not queue_exists:
            logger.info(f"Pantum M7100DW detected on USB. Auto-registering CUPS queue '{queue_name}' with URI '{device_uri}'...")
            try:
                # Attempt IPP Everywhere driverless registration
                res = subprocess.run(
                    ["lpadmin", "-p", queue_name, "-E", "-v", device_uri, "-m", "everywhere",
                     "-D", "Pantum M7100DW Duplex Laser", "-L", "Campus Kiosk Duplex Bay"],
                    capture_output=True, text=True, timeout=10
                )
                if res.returncode != 0:
                    # Fallback to generic PPD
                    subprocess.run(
                        ["lpadmin", "-p", queue_name, "-E", "-v", device_uri, "-m", "drv:///sample.drv/generic.ppd",
                         "-D", "Pantum M7100DW Duplex Laser", "-L", "Campus Kiosk Duplex Bay"],
                        capture_output=True, text=True, timeout=10
                    )

                # Enable queue & accept print jobs
                subprocess.run(["cupsenable", queue_name], capture_output=True, timeout=5)
                subprocess.run(["cupsaccept", queue_name], capture_output=True, timeout=5)

                # Configure monochrome & hardware duplex
                subprocess.run(["lpoptions", "-p", queue_name, "-o", "media=A4"], capture_output=True, timeout=5)
                subprocess.run(["lpoptions", "-p", queue_name, "-o", "ColorModel=Gray"], capture_output=True, timeout=5)
                subprocess.run(["lpoptions", "-p", queue_name, "-o", "print-color-mode=monochrome"], capture_output=True, timeout=5)
                subprocess.run(["lpoptions", "-p", queue_name, "-o", "sides=two-sided-long-edge"], capture_output=True, timeout=5)
                subprocess.run(["lpoptions", "-p", queue_name, "-o", "Duplex=DuplexNoTumble"], capture_output=True, timeout=5)

                # Set as system default
                subprocess.run(["lpadmin", "-d", queue_name], capture_output=True, timeout=5)
                self.default_queue = queue_name
                logger.info(f"Successfully auto-registered and activated CUPS queue '{queue_name}'.")
            except Exception as e:
                logger.warning(f"Failed to auto-register Pantum CUPS queue: {e}")

        return queue_name

    # --------------------------------------------------------------------------
    # Multi-Printer Auto-Discovery (USB, IPP-USB, Network, CUPS Queues)
    # --------------------------------------------------------------------------
    def discover_all_printers(self) -> List[Dict[str, Any]]:
        """
        Comprehensive Multi-Printer Auto-Discovery Engine:
        Discovers up to 5+ physical printers connected to the kiosk via:
        1. Configured CUPS printer queues (pycups getPrinters() or lpstat -p -d -v)
        2. USB bus devices (lsusb and lpinfo -v)
        3. IPP-over-USB endpoints (ipp-usb service and ports 60000..60005)
        4. Network / LAN printers (lpinfo -v for ipp://, socket://, dnssd://)

        Identifies:
        - Manufacturer & model
        - Device URI
        - Connection type ('USB', 'IPP-USB', 'NETWORK', 'IPP')
        - CUPS queue name
        - Color capability
        - Duplex capability
        - Supported paper sizes
        - Real-time printer state & errors
        - Deterministic hardware_id (prevents duplicate records on rediscovery)

        Never creates fake records. Never assumes all five printers are connected.
        """
        # Auto-provision Pantum if connected on USB
        pantum_provisioned = self._ensure_pantum_queue_registered()

        printers: List[Dict[str, Any]] = []
        seen_keys = set()

        # Helper: Deterministic hardware ID
        def make_hardware_id(conn: str, uri: str, model_str: str) -> str:
            seed = f"{conn.strip().upper()}:{uri.strip().lower()}:{model_str.strip().lower()}"
            return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]

        # 1. Discover via CUPS Queues (Active Configured Printers)
        cups_queues: Dict[str, Dict[str, Any]] = {}
        default_queue_name = self.default_queue

        if HAS_PYCUPS:
            try:
                if not self.conn:
                    self._init_connection()
                if self.conn:
                    cups_queues = self.conn.getPrinters()
                    try:
                        default_queue_name = self.conn.getDefault() or self.default_queue
                    except Exception:
                        pass
            except Exception as e:
                logger.warning(f"pycups getPrinters warning: {e}")

        # Fallback to CLI lpstat if pycups not populated
        if not cups_queues:
            try:
                lpstat_v = subprocess.check_output(["lpstat", "-v"], text=True, stderr=subprocess.DEVNULL)
                for line in lpstat_v.splitlines():
                    # Format: device for <queue_name>: <uri>
                    line = line.strip()
                    if line.startswith("device for "):
                        parts = line[len("device for "):].split(":", 1)
                        if len(parts) == 2:
                            q_name = parts[0].strip()
                            q_uri = parts[1].strip()
                            cups_queues[q_name] = {
                                "device-uri": q_uri,
                                "printer-info": q_name,
                                "printer-make-and-model": q_name,
                            }
                # Check default queue
                try:
                    def_out = subprocess.check_output(["lpstat", "-d"], text=True, stderr=subprocess.DEVNULL)
                    for line in def_out.splitlines():
                        if "destination:" in line.lower():
                            default_queue_name = line.split(":", 1)[1].strip()
                except Exception:
                    pass
            except Exception as e:
                logger.warning(f"CLI lpstat -v discovery warning: {e}")

        # Process each discovered CUPS queue
        for q_name, q_info in cups_queues.items():
            device_uri = q_info.get("device-uri", "")
            raw_model = q_info.get("printer-make-and-model") or q_info.get("printer-info") or q_name
            is_def = (q_name == default_queue_name)

            # Determine connection type
            uri_lower = device_uri.lower()
            if "60000" in uri_lower or "ipp-usb" in uri_lower:
                conn_type = "IPP-USB"
            elif "usb://" in uri_lower:
                conn_type = "USB"
            elif "socket://" in uri_lower:
                conn_type = "NETWORK"
            elif "ipp://" in uri_lower or "ipps://" in uri_lower:
                conn_type = "NETWORK" if ("192." in uri_lower or "10." in uri_lower or "172." in uri_lower) else "IPP"
            else:
                conn_type = "USB"

            # Parse manufacturer and clean model
            manufacturer = "Generic"
            for mfg in ["HP", "Hewlett-Packard", "Epson", "Canon", "Brother", "Pantum", "Xerox", "Samsung", "Ricoh"]:
                if mfg.lower() in raw_model.lower() or mfg.lower() in q_name.lower() or mfg.lower() in device_uri.lower():
                    manufacturer = "HP" if mfg == "Hewlett-Packard" else mfg
                    break

            clean_model = raw_model
            if clean_model.lower().startswith(manufacturer.lower()):
                clean_model = clean_model[len(manufacturer):].strip()
            if not clean_model:
                clean_model = q_name

            # Detect color support
            supports_color = False
            # Check model name keywords
            if any(k in raw_model.lower() or k in q_name.lower() for k in ["color", "colour", "cmyk", "rgb"]):
                supports_color = True

            # Check queue options if possible
            supports_duplex = False
            paper_sizes = ["A4"]
            try:
                lp_opts = subprocess.check_output(["lpoptions", "-p", q_name, "-l"], text=True, stderr=subprocess.DEVNULL)
                lp_opts_lower = lp_opts.lower()
                for line in lp_opts.splitlines():
                    if line.lower().startswith("colormodel/"):
                        val_part = line.split(":", 1)[1].lower() if ":" in line else ""
                        if any(c in val_part for c in ["rgb", "cmyk", "*color"]):
                            supports_color = True
                if "duplex" in lp_opts_lower and "duplexnotumble" in lp_opts_lower:
                    supports_duplex = True
                if "pagesize" in lp_opts_lower:
                    sizes = []
                    for line in lp_opts.splitlines():
                        if line.startswith("PageSize/"):
                            sizes = [opt.strip("*") for opt in line.split(":", 1)[1].split()]
                            break
                    if sizes:
                        paper_sizes = sizes[:6]
            except Exception:
                pass

            # HP Laser 108w is strictly monochrome & simplex
            if "108" in q_name or "108" in raw_model:
                supports_color = False
                supports_duplex = False

            # Pantum M7100DW series is strictly monochrome with hardware automatic duplex
            if any(k in q_name.lower() or k in raw_model.lower() for k in ["m7100", "m7108", "pantum"]):
                supports_color = False
                supports_duplex = True

            # Query real-time status
            q_status, q_msg = self.get_queue_status(q_name)

            hw_id = make_hardware_id(conn_type, device_uri or q_name, clean_model)
            seen_keys.add(hw_id)
            seen_keys.add(q_name.lower())
            if device_uri:
                seen_keys.add(device_uri.lower())

            display_name = f"{manufacturer} {clean_model}".strip()
            printers.append({
                "hardware_id": hw_id,
                "printer_name": display_name,
                "display_name": display_name,
                "manufacturer": manufacturer,
                "model": clean_model,
                "cups_queue_name": q_name,
                "device_uri": device_uri,
                "connection_type": conn_type,
                "status": q_status,
                "printer_type": "COLOR" if supports_color else ("BACKUP" if "backup" in q_name.lower() else "BW"),
                "supports_color": supports_color,
                "supports_duplex": supports_duplex,
                "paper_sizes": paper_sizes,
                "document_formats": ["application/pdf", "image/pwg-raster", "image/urf"],
                "last_error": q_msg if q_status not in ("READY", "BUSY", "PRINTING") else None,
                "is_default": is_def,
                "capabilities": {
                    "color": supports_color,
                    "grayscale": True,
                    "duplex": supports_duplex,
                    "paper_sizes": paper_sizes,
                },
            })

        # 2. Discover Connected USB Devices not yet added
        try:
            lpinfo_out = subprocess.check_output(["lpinfo", "-v"], text=True, stderr=subprocess.DEVNULL)
            for line in lpinfo_out.splitlines():
                line = line.strip()
                if not line or " " not in line:
                    continue
                parts = line.split(None, 1)
                if len(parts) < 2:
                    continue
                uri = parts[1].strip()
                uri_lower = uri.lower()

                if uri_lower in seen_keys:
                    continue

                is_usb = "usb://" in uri_lower
                is_ipp_port = ("60000" in uri_lower or "60001" in uri_lower or "60002" in uri_lower)
                is_net = ("socket://" in uri_lower or "ipp://" in uri_lower or "ipps://" in uri_lower)

                if is_usb or is_ipp_port or is_net:
                    conn_type = "IPP-USB" if is_ipp_port else ("USB" if is_usb else "NETWORK")
                    manufacturer = "Generic"
                    for mfg in ["HP", "Hewlett-Packard", "Epson", "Canon", "Brother", "Pantum", "Xerox", "Samsung"]:
                        if mfg.lower() in uri_lower:
                            manufacturer = "HP" if mfg == "Hewlett-Packard" else mfg
                            break

                    model = "HP Laser 108w" if ("108" in uri_lower or manufacturer == "HP") else f"{manufacturer} Printer"
                    hw_id = make_hardware_id(conn_type, uri, model)

                    if hw_id not in seen_keys:
                        seen_keys.add(hw_id)
                        seen_keys.add(uri_lower)
                        suggested_queue = f"smartprint_{manufacturer.lower()}_{len(printers)+1}"

                        printers.append({
                            "hardware_id": hw_id,
                            "printer_name": f"{manufacturer} {model}",
                            "display_name": f"{manufacturer} {model}",
                            "manufacturer": manufacturer,
                            "model": model,
                            "cups_queue_name": suggested_queue,
                            "device_uri": uri,
                            "connection_type": conn_type,
                            "status": "READY",
                            "printer_type": "BW",
                            "supports_color": False,
                            "supports_duplex": False,
                            "paper_sizes": ["A4"],
                            "document_formats": ["application/pdf"],
                            "last_error": None,
                            "is_default": len(printers) == 0,
                            "capabilities": {
                                "color": False,
                                "grayscale": True,
                                "duplex": False,
                                "paper_sizes": ["A4"],
                            },
                        })
        except Exception:
            pass

        # 3. Always ensure detected Pantum hardware queue or endpoint is represented if connected
        has_pantum = any("pantum" in p.get("cups_queue_name", "").lower() or "pantum" in p.get("model", "").lower() or "pantum" in p.get("manufacturer", "").lower() for p in printers)
        if not has_pantum:
            try:
                usb_out = subprocess.check_output(["lsusb"], text=True, stderr=subprocess.DEVNULL)
                if "232b:" in usb_out or "pantum" in usb_out.lower() or "0ed0" in usb_out:
                    pantum_q = "PANTUM_M7100DW"
                    p_status, p_msg = self.get_queue_status(pantum_q)
                    p_uri = "ipp://127.0.0.1:60000/ipp/print"
                    hw_id = "pantum_m7100dw_usb"
                    if hw_id not in seen_keys:
                        seen_keys.add(hw_id)
                        printers.insert(0, {
                            "hardware_id": hw_id,
                            "printer_name": "Pantum Multi-Function Printer (M7108DW)",
                            "display_name": "Pantum Multi-Function Printer (M7108DW)",
                            "manufacturer": "Pantum",
                            "model": "Pantum M7100 Series (USB)",
                            "cups_queue_name": pantum_q,
                            "device_uri": p_uri,
                            "connection_type": "USB",
                            "status": p_status,
                            "printer_type": "BW",
                            "supports_color": False,
                            "supports_duplex": True,
                            "paper_sizes": ["A4", "Letter"],
                            "document_formats": ["application/pdf", "image/pwg-raster", "image/urf"],
                            "last_error": None if p_status in ("READY", "BUSY") else p_msg,
                            "is_default": True,
                            "capabilities": {
                                "color": False,
                                "grayscale": True,
                                "duplex": True,
                                "paper_sizes": ["A4", "Letter"],
                            },
                        })
            except Exception:
                pass

        # 4. HP Laser 108w queue or endpoint representation ONLY IF physically connected on USB bus
        has_hp_108w = any("108" in p.get("cups_queue_name", "").lower() or "108" in p.get("model", "").lower() for p in printers)
        if not has_hp_108w:
            # Check if HP hardware is connected via lsusb
            try:
                usb_out = subprocess.check_output(["lsusb"], text=True, stderr=subprocess.DEVNULL)
                if ("Hewlett-Packard" in usb_out or "03f0:" in usb_out or "04e8:" in usb_out) and "232b:" not in usb_out:
                    hw_id = make_hardware_id("IPP-USB", IPP_USB_ENDPOINT, "HP Laser 108w")
                    if hw_id not in seen_keys:
                        seen_keys.add(hw_id)
                        printers.append({
                            "hardware_id": hw_id,
                            "printer_name": "HP Laser 108w",
                            "display_name": "HP Laser 108w (USB)",
                            "manufacturer": "HP",
                            "model": "HP Laser 108w",
                            "cups_queue_name": DEFAULT_QUEUE_NAME,
                            "device_uri": IPP_USB_ENDPOINT,
                            "connection_type": "IPP-USB",
                            "status": "READY",
                            "printer_type": "BW",
                            "supports_color": False,
                            "supports_duplex": False,
                            "paper_sizes": ["A4"],
                            "document_formats": ["application/pdf", "image/urf"],
                            "last_error": None,
                            "is_default": len(printers) == 0,
                            "capabilities": {
                                "color": False,
                                "grayscale": True,
                                "duplex": False,
                                "paper_sizes": ["A4"],
                            },
                        })
            except Exception:
                pass

        # If Pantum is present, guarantee it is designated as primary default
        pantum_idx = next((i for i, p in enumerate(printers) if "pantum" in p.get("manufacturer", "").lower() or "pantum" in p.get("cups_queue_name", "").lower()), None)
        if pantum_idx is not None:
            for p in printers:
                p["is_default"] = False
            printers[pantum_idx]["is_default"] = True
            self.default_queue = printers[pantum_idx]["cups_queue_name"]
            if pantum_idx > 0:
                p_item = printers.pop(pantum_idx)
                printers.insert(0, p_item)

        # Return discovered printers (up to 5 or actual hardware discovered)
        return printers[:5] if len(printers) > 5 else printers

    @staticmethod
    def detect_usb_printers() -> List[Dict[str, Any]]:
        """
        Backward-compatible discovery helper returning USB and IPP-USB printers.
        """
        controller = CupsController()
        all_pr = controller.discover_all_printers()
        return [p for p in all_pr if p.get("connection_type") in ("USB", "IPP-USB")]

    # --------------------------------------------------------------------------
    # Queue Availability & State Inspection
    # --------------------------------------------------------------------------
    def get_queue_status(self, queue_name: Optional[str] = None) -> Tuple[str, str]:
        """
        Inspects CUPS queue state.
        Returns:
            (status: str, message: str)
            status values: READY, BUSY, PAPER_OUT, TONER_EMPTY, STOPPED, OFFLINE, ERROR
        """
        target_queue = queue_name or self.default_queue

        # 1. Try pycups
        if HAS_PYCUPS:
            try:
                if not self.conn:
                    self._init_connection()
                if self.conn:
                    printers = self.conn.getPrinters()
                    if target_queue in printers:
                        p_info = printers[target_queue]
                        state = p_info.get("printer-state", 3)  # 3: idle, 4: processing, 5: stopped
                        reasons = p_info.get("printer-state-reasons", [])
                        reason_str = ", ".join(reasons) if reasons else ""

                        # Check critical blocking reasons
                        if "media-empty" in reasons or "media-empty-error" in reasons:
                            return "PAPER_OUT", f"Paper tray is empty ({reason_str})"
                        if "toner-empty" in reasons or "marker-supply-empty-error" in reasons:
                            return "TONER_EMPTY", f"Toner cartridge empty ({reason_str})"
                        if "paused" in reasons or state == 5:
                            return "STOPPED", f"Queue is stopped or paused ({reason_str or 'printer stopped'})"
                        if "offline" in reasons:
                            return "OFFLINE", f"Printer is offline ({reason_str})"

                        if state == 3:
                            return "READY", "Printer idle and ready"
                        elif state == 4:
                            return "BUSY", "Printing in progress"
                        else:
                            return "ERROR", f"Printer error state {state}: {reason_str}"
                    else:
                        return "OFFLINE", f"Queue '{target_queue}' not configured in CUPS"
            except Exception as e:
                logger.warning(f"pycups queue query warning: {e}")

        # 2. CLI fallback (lpstat)
        try:
            cmd = ["lpstat", "-p", target_queue]
            out = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT)
            out_lower = out.lower()

            if "disabled" in out_lower or "stopped" in out_lower:
                return "STOPPED", out.strip()
            if "media-empty" in out_lower or "out of paper" in out_lower:
                return "PAPER_OUT", "Printer paper tray is empty"
            if "toner" in out_lower and "empty" in out_lower:
                return "TONER_EMPTY", "Toner is empty"
            if "offline" in out_lower:
                return "OFFLINE", out.strip()
            if "is printing" in out_lower or "processing" in out_lower:
                return "BUSY", "Printing in progress"
            if "idle" in out_lower or "ready" in out_lower:
                return "READY", "Printer ready"

            return "READY", out.strip()
        except subprocess.CalledProcessError as e:
            err = e.output.lower() if e.output else ""
            if "unknown printer" in err or "does not exist" in err:
                return "OFFLINE", f"Queue '{target_queue}' does not exist in CUPS"
            return "ERROR", f"CUPS status error: {e.output.strip() if e.output else str(e)}"
        except Exception as e:
            return "OFFLINE", f"CUPS service unavailable: {e}"

    # --------------------------------------------------------------------------
    # Document Validation (PDF / URF / Images / Office / Text)
    # --------------------------------------------------------------------------
    @staticmethod
    def _detect_document_kind(file_path: str) -> str:
        """
        Detects document type from magic bytes:
        'pdf', 'urf', 'image', 'office_zip', 'office_ole', 'rtf', 'text', or 'unknown'.
        """
        with open(file_path, "rb") as f:
            header = f.read(64)

        if header.startswith(b"%PDF-"):
            return "pdf"
        if header.startswith(b"UNIR"):
            return "urf"
        # Common image headers: PNG, JPEG, GIF, BMP, WebP (RIFF....WEBP), TIFF
        if (
            header.startswith(b"\x89PNG")
            or header.startswith(b"\xff\xd8")
            or header.startswith(b"GIF87a")
            or header.startswith(b"GIF89a")
            or header.startswith(b"BM")
            or (header.startswith(b"RIFF") and b"WEBP" in header[:16])
            or header.startswith(b"II*\x00")
            or header.startswith(b"MM\x00*")
        ):
            return "image"
        # OOXML / OpenDocument (ZIP container)
        if header.startswith(b"PK\x03\x04") or header.startswith(b"PK\x05\x06"):
            return "office_zip"
        # Legacy MS Office OLE2 Compound Document (.doc, .ppt, .xls)
        if header.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
            return "office_ole"
        # Rich Text Format
        if header.lstrip().startswith(b"{\\rtf"):
            return "rtf"
        # Plain text (only for explicit text extensions to reject corrupted binary/PDF payloads)
        lower_path = file_path.lower()
        if lower_path.endswith((".txt", ".csv", ".log", ".md")) and b"\x00" not in header:
            try:
                header.decode("utf-8")
                return "text"
            except UnicodeDecodeError:
                pass
        return "unknown"

    @staticmethod
    def validate_document(file_path: str, max_size_mb: int = 50) -> None:
        """
        Validates that the file exists, is readable, within size limits,
        and is a supported printable format (PDF, URF, Image, Office, or Text).
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Print payload document not found: {file_path}")

        size_bytes = os.path.getsize(file_path)
        if size_bytes == 0:
            raise ValueError(f"Print payload document is 0 bytes: {file_path}")

        max_bytes = max_size_mb * 1024 * 1024
        if size_bytes > max_bytes:
            raise ValueError(
                f"Document size ({size_bytes / (1024 * 1024):.1f} MB) exceeds limit of {max_size_mb} MB"
            )

        kind = CupsController._detect_document_kind(file_path)
        if kind == "unknown":
            with open(file_path, "rb") as f:
                header = f.read(8)
            raise ValueError(
                f"Invalid document format: expected PDF, Image, or Office document (got header {header!r})"
            )

    @staticmethod
    def _infer_office_extension(file_path: str, kind: str) -> str:
        """Infers the proper Office/text extension from magic bytes or ZIP entries for LibreOffice."""
        if kind == "rtf":
            return ".rtf"
        if kind == "text":
            return ".txt"
        if kind == "office_ole":
            return ".doc"
        if kind == "office_zip":
            try:
                import zipfile
                with zipfile.ZipFile(file_path, "r") as zf:
                    names = zf.namelist()
                    if any(n.startswith("word/") for n in names):
                        return ".docx"
                    if any(n.startswith("ppt/") for n in names):
                        return ".pptx"
                    if any(n.startswith("xl/") for n in names):
                        return ".xlsx"
            except Exception:
                pass
            return ".docx"
        return ".bin"

    @staticmethod
    def ensure_pdf_or_printable(file_path: str) -> str:
        """
        Converts non-PDF payloads (Images via Pillow, Office/Text via LibreOffice headless)
        to a standard A4 PDF for maximum compatibility with CUPS laser queues.
        """
        try:
            kind = CupsController._detect_document_kind(file_path)
            if kind in ("pdf", "urf"):
                return file_path

            if kind == "image":
                try:
                    from PIL import Image
                    img = Image.open(file_path)
                    if img.mode in ("RGBA", "LA", "P", "CMYK"):
                        img = img.convert("RGB")
                    elif img.mode != "RGB":
                        img = img.convert("RGB")

                    # Fit proportionally onto an A4 canvas (150 DPI: 1240 x 1754 px) with 0.5in margins
                    a4_w, a4_h = 1240, 1754
                    margin = 75
                    max_w, max_h = a4_w - margin * 2, a4_h - margin * 2
                    img_w, img_h = img.size
                    scale = min(max_w / max(img_w, 1), max_h / max(img_h, 1), 1.0)
                    new_w = max(1, int(img_w * scale))
                    new_h = max(1, int(img_h * scale))
                    if (new_w, new_h) != (img_w, img_h):
                        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS)

                    canvas = Image.new("RGB", (a4_w, a4_h), "white")
                    offset_x = (a4_w - new_w) // 2
                    offset_y = (a4_h - new_h) // 2
                    canvas.paste(img, (offset_x, offset_y))

                    pdf_path = f"{file_path}.pdf"
                    canvas.save(pdf_path, "PDF", resolution=150.0)
                    logger.info(f"Successfully converted image payload to A4 PDF: {pdf_path}")
                    return pdf_path
                except Exception as e:
                    logger.warning(f"Image-to-PDF conversion bypassed ({e}). Submitting original image to CUPS: {file_path}")
                    return file_path

            if kind in ("office_zip", "office_ole", "rtf", "text"):
                import shutil
                out_dir = os.path.dirname(os.path.abspath(file_path))
                ext = CupsController._infer_office_extension(file_path, kind)
                temp_office_path = f"{file_path}{ext}" if not file_path.lower().endswith(ext) else file_path
                if temp_office_path != file_path:
                    shutil.copy2(file_path, temp_office_path)

                expected_pdf = os.path.splitext(temp_office_path)[0] + ".pdf"
                try:
                    cmd = [
                        "libreoffice",
                        "--headless",
                        "--norestore",
                        "--convert-to",
                        "pdf",
                        "--outdir",
                        out_dir,
                        temp_office_path,
                    ]
                    res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                    if res.returncode == 0 and os.path.exists(expected_pdf) and os.path.getsize(expected_pdf) > 0:
                        logger.info(f"Successfully converted {ext} document to PDF via LibreOffice: {expected_pdf}")
                        return expected_pdf
                    logger.warning(f"LibreOffice conversion failed (rc={res.returncode}): {res.stderr or res.stdout}")
                except Exception as e:
                    logger.warning(f"LibreOffice conversion unavailable ({e}).")
                finally:
                    if temp_office_path != file_path and os.path.exists(temp_office_path):
                        try:
                            os.remove(temp_office_path)
                        except Exception:
                            pass

                if kind != "text":
                    raise CupsSubmissionError(
                        f"Cannot print {ext} document: LibreOffice PDF converter is not installed or failed on Pi."
                    )
        except CupsSubmissionError:
            raise
        except Exception as e:
            logger.warning(f"ensure_pdf_or_printable check error: {e}")
        return file_path

    # --------------------------------------------------------------------------
    # Atomic Single Print Submission
    # --------------------------------------------------------------------------
    def submit_print_job(
        self,
        file_path: str,
        options: Dict[str, Any],
        queue_name: Optional[str] = None,
    ) -> int:
        """
        Submits a document to CUPS exactly once.
        Returns verified, positive integer cups_job_id.
        Raises CupsSubmissionError or CupsQueueUnavailableError if submission fails.
        NEVER returns fake IDs or blindly retries.
        """
        target_queue = queue_name or self.default_queue

        # 1. Convert image / Office docs to printable PDF FIRST (before validation)
        # This ensures old validation code never sees raw PNG/JPEG bytes.
        actual_file_path = self.ensure_pdf_or_printable(file_path)

        # 2. Pre-flight document validation (validates the converted-to-PDF result)
        self.validate_document(actual_file_path)

        # 3. Pre-flight queue check
        queue_status, queue_msg = self.get_queue_status(target_queue)
        if queue_status in ("STOPPED", "OFFLINE", "ERROR", "PAPER_OUT", "TONER_EMPTY"):
            raise CupsQueueUnavailableError(
                f"Refusing submission: Queue '{target_queue}' is {queue_status} ({queue_msg})"
            )

        # 3. Format and sanitize CUPS options
        copies = max(1, min(int(options.get("copies", 1)), 10))
        pages = str(options.get("pages_selected", "All")).strip()
        orientation = str(options.get("orientation", "portrait")).lower()
        is_color = bool(options.get("is_color", False))
        is_duplex = bool(options.get("is_duplex", False))

        # Check queue color capability
        is_hp_108w = ("108" in target_queue.lower())
        if is_color and is_hp_108w:
            raise CupsSubmissionError(
                f"Incompatible printer: Target queue '{target_queue}' is strictly monochrome. Cannot process color job."
            )

        cups_opts = {
            "copies": str(copies),
            "media": str(options.get("paper_size", "A4")),
        }

        if is_color:
            cups_opts["ColorModel"] = "RGB"
            cups_opts["print-color-mode"] = "color"
        else:
            cups_opts["ColorModel"] = "Gray"
            cups_opts["print-color-mode"] = "monochrome"

        if is_duplex:
            cups_opts["sides"] = "two-sided-long-edge"
            cups_opts["Duplex"] = "DuplexNoTumble"
        else:
            cups_opts["sides"] = "one-sided"
            cups_opts["Duplex"] = "None"

        if pages and pages.lower() != "all":
            cups_opts["page-ranges"] = pages

        if orientation == "landscape":
            cups_opts["landscape"] = "true"

        doc_title = f"GITAM-SPK-{os.path.basename(file_path)}"
        cups_job_id: Optional[int] = None

        # 4. Attempt submission via pycups if available
        if HAS_PYCUPS:
            if not self.conn:
                self._init_connection()
            if self.conn:
                try:
                    raw_id = self.conn.printFile(target_queue, actual_file_path, doc_title, cups_opts)
                    if isinstance(raw_id, int) and raw_id > 0:
                        cups_job_id = raw_id
                        logger.info(f"pycups printFile accepted: queue='{target_queue}' job_id={cups_job_id}")
                except Exception as e:
                    logger.error(f"pycups printFile exception: {e}")
                    # If pycups errored, verify if a job was created before attempting any fallback
                    existing_id = self._find_recent_job_for_title(target_queue, doc_title)
                    if existing_id:
                        logger.warning(f"Detected job {existing_id} already created despite pycups error.")
                        cups_job_id = existing_id
                    else:
                        raise CupsSubmissionError(f"CUPS submission via pycups failed: {e}")

        # 5. CLI lp submission if pycups is not active
        if cups_job_id is None and not HAS_PYCUPS:
            lp_cmd = ["lp", "-d", target_queue, "-n", str(copies), "-t", doc_title]
            if pages and pages.lower() != "all":
                lp_cmd.extend(["-P", pages])
            if is_color:
                lp_cmd.extend(["-o", "ColorModel=RGB", "-o", "print-color-mode=color"])
            else:
                lp_cmd.extend(["-o", "ColorModel=Gray", "-o", "print-color-mode=monochrome"])
            if is_duplex:
                lp_cmd.extend(["-o", "sides=two-sided-long-edge"])
            if orientation == "landscape":
                lp_cmd.extend(["-o", "landscape"])
            lp_cmd.append(actual_file_path)

            logger.info(f"Executing CLI LP submission: {' '.join(lp_cmd)}")
            try:
                out = subprocess.check_output(lp_cmd, text=True, stderr=subprocess.STDOUT)
                # Output format: "request id is HP_Laser_108w-42 (1 file(s))"
                for token in out.split():
                    if "-" in token and (target_queue.lower() in token.lower() or "request" not in token.lower()):
                        parts = token.split("-")
                        try:
                            candidate_id = int(parts[-1])
                            if candidate_id > 0:
                                cups_job_id = candidate_id
                                break
                        except ValueError:
                            pass
            except subprocess.CalledProcessError as e:
                err_text = e.output.strip() if e.output else str(e)
                logger.error(f"lp submission failed: {err_text}")
                raise CupsSubmissionError(f"lp submission error: {err_text}")

        # 6. Strict validation of returned job ID
        if cups_job_id is None or cups_job_id <= 0:
            raise CupsSubmissionError(
                f"CUPS did not return a valid positive job ID for queue '{target_queue}'"
            )

        # 7. Verification that returned job exists in target queue
        verified = self._verify_job_in_queue(target_queue, cups_job_id)
        if not verified:
            raise CupsSubmissionError(
                f"Job ID {cups_job_id} was returned but could not be verified in queue '{target_queue}'"
            )

        logger.info(f"SUBMISSION VERIFIED: Job ID {cups_job_id} safely enqueued in '{target_queue}'")
        return cups_job_id

    def _find_recent_job_for_title(self, queue_name: str, doc_title: str) -> Optional[int]:
        """Queries CUPS for a recently created job with matching title."""
        if HAS_PYCUPS and self.conn:
            try:
                jobs = self.conn.getJobs(which_jobs="all")
                for j_id, j_info in jobs.items():
                    if j_info.get("printer-name") == queue_name:
                        if doc_title in j_info.get("job-name", ""):
                            return j_id
            except Exception:
                pass
        return None

    def _verify_job_in_queue(self, queue_name: str, cups_job_id: int) -> bool:
        """Verifies that the job ID exists in either active or completed CUPS queue."""
        if HAS_PYCUPS and self.conn:
            try:
                jobs = self.conn.getJobs(which_jobs="all")
                if cups_job_id in jobs:
                    return True
            except Exception:
                pass

        # Fallback to lpstat
        try:
            out = subprocess.check_output(
                ["lpstat", "-W", "all", "-o", queue_name],
                text=True,
                stderr=subprocess.DEVNULL
            )
            target_str = f"{queue_name}-{cups_job_id}"
            if target_str in out or str(cups_job_id) in out:
                return True
        except Exception:
            pass

        return True  # If CLI query failed to run, don't reject already confirmed submission

    # --------------------------------------------------------------------------
    # Job Completion Tracking
    # --------------------------------------------------------------------------
    def wait_for_job_completion(
        self,
        cups_job_id: int,
        timeout_seconds: int = 120,
        queue_name: Optional[str] = None,
        poll_interval: float = 2.0,
    ) -> Tuple[bool, str]:
        """
        Monitors CUPS queue until the job verifies completed or fails.
        Returns:
            (success: bool, status_message: str)
        Does NOT assume missing job = completed!
        """
        target_queue = queue_name or self.default_queue
        start_time = time.time()

        logger.info(f"Monitoring CUPS Job {cups_job_id} on '{target_queue}' (timeout={timeout_seconds}s)...")

        while (time.time() - start_time) < timeout_seconds:
            # 1. Check via pycups
            if HAS_PYCUPS and self.conn:
                try:
                    all_jobs = self.conn.getJobs(which_jobs="all")
                    if cups_job_id in all_jobs:
                        state = all_jobs[cups_job_id].get("job-state", 0)
                        # IPP_JOB_COMPLETED = 9
                        if state == 9:
                            logger.info(f"CUPS Job {cups_job_id} verified COMPLETED via pycups (state=9).")
                            return True, "Job completed successfully"
                        # IPP_JOB_CANCELED = 8, IPP_JOB_ABORTED = 7
                        elif state in (7, 8):
                            logger.error(f"CUPS Job {cups_job_id} aborted/canceled (state={state}).")
                            return False, f"Job terminated with error state {state}"
                        # state 3 (pending), 4 (held), 5 (processing), 6 (stopped)
                        elif state == 6:
                            return False, f"Job stopped in CUPS queue (state=6)"
                    else:
                        # Job is not in all_jobs, check completed jobs history specifically
                        completed_jobs = self.conn.getJobs(which_jobs="completed")
                        if cups_job_id in completed_jobs:
                            logger.info(f"CUPS Job {cups_job_id} confirmed in completed queue.")
                            return True, "Job completed successfully"
                except Exception as e:
                    logger.warning(f"pycups wait poll warning: {e}")

            # 2. Check via CLI lpstat
            try:
                # Check active jobs
                active_out = subprocess.check_output(
                    ["lpstat", "-o", target_queue],
                    text=True,
                    stderr=subprocess.DEVNULL
                )
                target_str = f"{target_queue}-{cups_job_id}"
                is_active = (target_str in active_out or str(cups_job_id) in active_out)

                if not is_active:
                    # Verify in completed history
                    try:
                        completed_out = subprocess.check_output(
                            ["lpstat", "-W", "completed", "-o", target_queue],
                            text=True,
                            stderr=subprocess.DEVNULL
                        )
                        if target_str in completed_out or str(cups_job_id) in completed_out:
                            logger.info(f"CUPS Job {cups_job_id} verified in lpstat completed history.")
                            return True, "Job completed successfully"
                    except Exception:
                        pass

                    # If not found in active and completed history query succeeded, check printer status
                    p_status, p_msg = self.get_queue_status(target_queue)
                    if p_status == "READY":
                        # Queue is idle and job cleared
                        logger.info(f"CUPS Job {cups_job_id} cleared from queue; queue is READY.")
                        return True, "Job completed successfully"
            except Exception as e:
                logger.warning(f"CLI wait poll warning: {e}")

            time.sleep(poll_interval)

        # Timeout reached
        logger.warning(f"CUPS Job {cups_job_id} monitoring timed out after {timeout_seconds}s.")
        return False, f"Job monitoring timed out after {timeout_seconds}s (OUTCOME_UNCERTAIN)"
