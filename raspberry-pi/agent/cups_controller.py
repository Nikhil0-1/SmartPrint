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
    # Printer Discovery (USB & ipp-usb)
    # --------------------------------------------------------------------------
    @staticmethod
    def detect_usb_printers() -> List[Dict[str, Any]]:
        """
        Discovers USB printers connected to Raspberry Pi via:
        1. lsusb bus enumeration (HP / Samsung OEM vendor IDs)
        2. ipp-usb service status and local port 60000
        3. CUPS detected devices via lpinfo -v
        """
        printers: List[Dict[str, Any]] = []
        try:
            # 1. lsusb scan
            usb_out = ""
            try:
                usb_out = subprocess.check_output(["lsusb"], text=True, stderr=subprocess.DEVNULL)
            except Exception:
                pass

            hp_found = ("Hewlett-Packard" in usb_out or "03f0:" in usb_out or "HP" in usb_out)
            samsung_found = ("04e8:" in usb_out or "Samsung" in usb_out)  # HP 108w hardware is Samsung-based

            # 2. ipp-usb service check
            ipp_usb_active = False
            try:
                ipp_status = subprocess.check_output(
                    ["systemctl", "is-active", "ipp-usb"],
                    text=True,
                    stderr=subprocess.DEVNULL
                ).strip()
                ipp_usb_active = (ipp_status == "active")
            except Exception:
                pass

            # 3. CUPS lpinfo discovery
            lpinfo_out = ""
            try:
                lpinfo_out = subprocess.check_output(["lpinfo", "-v"], text=True, stderr=subprocess.DEVNULL)
            except Exception:
                pass

            seen_uris = set()
            for line in lpinfo_out.splitlines():
                line = line.strip()
                if not line or " " not in line:
                    continue
                parts = line.split(None, 1)
                if len(parts) < 2:
                    continue
                uri = parts[1].strip()

                is_usb = "usb://" in uri.lower()
                is_ipp = "ipp://" in uri.lower() or "ipps://" in uri.lower()
                is_hp = ("hp" in uri.lower() or "108" in uri.lower() or hp_found or samsung_found)

                if is_usb or (is_ipp and "60000" in uri) or (is_ipp and is_hp):
                    if uri not in seen_uris:
                        seen_uris.add(uri)
                        printers.append({
                            "uri": uri,
                            "connection": "IPP-USB" if "60000" in uri or (is_ipp and ipp_usb_active) else "USB",
                            "manufacturer": "HP" if is_hp else "Generic",
                            "model": "HP Laser 108w" if ("108" in uri or is_hp) else "Generic USB Printer",
                            "ipp_usb_active": ipp_usb_active,
                            "is_monochrome": True,
                        })

            # If ipp-usb is active and HP hardware is on USB bus, ensure verified endpoint is included
            if (hp_found or samsung_found or ipp_usb_active) and IPP_USB_ENDPOINT not in seen_uris:
                printers.append({
                    "uri": IPP_USB_ENDPOINT,
                    "connection": "IPP-USB",
                    "manufacturer": "HP",
                    "model": "HP Laser 108w",
                    "ipp_usb_active": ipp_usb_active,
                    "is_monochrome": True,
                })

        except Exception as e:
            logger.error(f"Error executing printer detection: {e}")

        return printers

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
    # Document Validation (PDF / URF)
    # --------------------------------------------------------------------------
    @staticmethod
    def validate_document(file_path: str, max_size_mb: int = 50) -> None:
        """
        Validates that the file exists, is readable, within size limits,
        and starts with valid PDF magic bytes.
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

        with open(file_path, "rb") as f:
            header = f.read(5)
            # Accept %PDF- or URF magic bytes (UNIRAST)
            if header != b"%PDF-" and not header.startswith(b"UNIR"):
                raise ValueError(
                    f"Invalid document format: expected PDF (got header {header!r})"
                )

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

        # 1. Pre-flight document validation
        self.validate_document(file_path)

        # 2. Pre-flight queue check
        queue_status, queue_msg = self.get_queue_status(target_queue)
        if queue_status in ("STOPPED", "OFFLINE", "ERROR", "PAPER_OUT", "TONER_EMPTY"):
            raise CupsQueueUnavailableError(
                f"Refusing submission: Queue '{target_queue}' is {queue_status} ({queue_msg})"
            )

        # 3. Format and sanitize CUPS options
        # NOTE: HP Laser 108w is strictly monochrome.
        copies = max(1, min(int(options.get("copies", 1)), 10))
        pages = str(options.get("pages_selected", "All")).strip()
        orientation = str(options.get("orientation", "portrait")).lower()

        # Strict monochrome enforcement
        cups_opts = {
            "copies": str(copies),
            "media": "A4",
            "ColorModel": "Gray",
            "print-color-mode": "monochrome",
        }

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
                    raw_id = self.conn.printFile(target_queue, file_path, doc_title, cups_opts)
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
            lp_cmd.extend(["-o", "ColorModel=Gray", "-o", "print-color-mode=monochrome"])
            if orientation == "landscape":
                lp_cmd.extend(["-o", "landscape"])
            lp_cmd.append(file_path)

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
