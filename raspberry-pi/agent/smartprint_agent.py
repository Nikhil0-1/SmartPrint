#!/usr/bin/env python3
"""
GITAM SMARTPRINT - Raspberry Pi Production Agent (v3.0)
Durable state-machine driven agent for autonomous campus printing.
Guarantees zero duplicate prints, crash safety, reliable cloud reporting with outbox,
pre-flight queue validation for HP Laser 108w, and bounded privacy retention.
"""

import os
import sys
import time
import json
import signal
import logging
import urllib.request
import urllib.parse
import urllib.error
import ssl
from typing import Optional, Dict, Any, Tuple

# Ensure current directory is on pythonpath
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from state_manager import (
    StateManager,
    STATE_RECEIVED,
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

# LOGGING SETUP
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] SMARTPRINT-AGENT: %(message)s"
)
logger = logging.getLogger("smartprint.agent")

CONFIG_FILE = os.getenv("SMARTPRINT_CONFIG", "/etc/smartprint/agent_config.json")
DEFAULT_BACKEND_URL = os.getenv("SMARTPRINT_BACKEND_URL", "https://smart-prints.vercel.app")
DEFAULT_KIOSK_ID = os.getenv("SMARTPRINT_KIOSK_ID", "GITAM-SPK-001")
DEFAULT_DEVICE_TOKEN = os.getenv("SMARTPRINT_DEVICE_TOKEN", "")


def load_config() -> Dict[str, Any]:
    """Loads agent configuration from /etc/smartprint/agent_config.json or environment."""
    cfg = {
        "backend_url": DEFAULT_BACKEND_URL,
        "kiosk_id": DEFAULT_KIOSK_ID,
        "device_token": DEFAULT_DEVICE_TOKEN,
        "organization_id": os.getenv("SMARTPRINT_ORG_ID", ""),
        "poll_interval_sec": 1.5,
        "heartbeat_interval_sec": 10,
        "outbox_interval_sec": 2,
        "verify_ssl": True,
        "cups_queue": os.getenv("SMARTPRINT_CUPS_QUEUE", "PANTUM_M7100DW"),
        "max_pdf_size_mb": 50,
        "job_timeout_seconds": 120,
    }

    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                user_cfg = json.load(f)
                cfg.update(user_cfg)
        except Exception as e:
            logger.warning(f"Failed to read config file {CONFIG_FILE}: {e}")

    # Fallback to env vars if file did not set them
    if not cfg.get("kiosk_id"):
        cfg["kiosk_id"] = os.getenv("SMARTPRINT_KIOSK_ID", DEFAULT_KIOSK_ID)
    if not cfg.get("device_token"):
        cfg["device_token"] = os.getenv("SMARTPRINT_DEVICE_TOKEN", "")

    return cfg


def get_system_telemetry() -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """Reads Raspberry Pi CPU temperature, RAM usage, and Disk usage."""
    cpu_temp: Optional[float] = None
    ram_usage: Optional[float] = None
    disk_usage: Optional[float] = None

    # CPU Temp
    try:
        if os.path.exists("/sys/class/thermal/thermal_zone0/temp"):
            with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
                raw = f.read().strip()
                if raw:
                    cpu_temp = round(float(raw) / 1000.0, 1)
    except Exception:
        pass

    # RAM Usage
    try:
        if os.path.exists("/proc/meminfo"):
            mem = {}
            with open("/proc/meminfo", "r") as f:
                for line in f:
                    parts = line.split(":")
                    if len(parts) == 2:
                        key = parts[0].strip()
                        val = parts[1].strip().split()[0]
                        mem[key] = int(val)
            total = mem.get("MemTotal", 0)
            free = mem.get("MemAvailable", mem.get("MemFree", 0))
            if total > 0:
                ram_usage = round(((total - free) / total) * 100.0, 1)
    except Exception:
        pass

    # Disk Usage
    try:
        import shutil
        total, used, free = shutil.disk_usage("/")
        if total > 0:
            disk_usage = round((used / total) * 100.0, 1)
    except Exception:
        pass

    return cpu_temp, ram_usage, disk_usage


def get_hardware_model() -> Optional[str]:
    """Dynamically identifies physical Raspberry Pi hardware model."""
    for dt_path in ("/proc/device-tree/model", "/sys/firmware/devicetree/base/model"):
        try:
            if os.path.exists(dt_path):
                try:
                    with open(dt_path, "rb") as f:
                        raw = f.read().decode("utf-8", errors="ignore").replace("\x00", "").strip()
                        if raw:
                            return raw
                except Exception:
                    with open(dt_path, "r", encoding="utf-8", errors="ignore") as f:
                        raw = f.read().replace("\x00", "").strip()
                        if raw:
                            return raw
        except Exception:
            pass

    # /proc/cpuinfo fallback
    try:
        if os.path.exists("/proc/cpuinfo"):
            with open("/proc/cpuinfo", "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    stripped = line.strip()
                    if stripped.startswith("Model"):
                        parts = stripped.split(":", 1)
                        if len(parts) == 2 and parts[1].strip():
                            return parts[1].strip()
    except Exception:
        pass

    env_model = os.getenv("SMARTPRINT_HARDWARE_MODEL")
    if env_model:
        return env_model.strip()

    return None


def get_local_ip() -> Optional[str]:
    """Detects primary local network interface IP without transmitting network packets."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        pass

    try:
        hostname = socket.gethostname()
        ip = socket.gethostbyname(hostname)
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass

    return None


# Legacy compatibility aliases
def init_local_db():
    """Initializes local state database (legacy compatibility alias)."""
    return StateManager()


def cleanup_stale_temp_files():
    """Cleans up stale temporary files (legacy compatibility alias)."""
    return DocumentManager().cleanup_stale_active_workspaces()


class SmartPrintAgent:
    """Production Agent managing kiosk lifecycle on Raspberry Pi."""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or load_config()
        state_dir = self.config.get("state_dir") or os.getenv("SMARTPRINT_STATE_DIR")
        self.state_mgr = StateManager(state_dir=state_dir)
        self.cups = CupsController(default_queue=self.config.get("cups_queue", "HP_Laser_108w"))
        self.doc_mgr = DocumentManager(state_dir=state_dir)
        self.routing_config: Dict[str, Any] = {}
        self.running = True

        # Register OS signal handlers for graceful shutdown
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

    def _handle_signal(self, signum, frame):
        """Gracefully stops agent without interrupting active atomic steps."""
        sig_name = "SIGTERM" if signum == signal.SIGTERM else "SIGINT"
        logger.info(f"Received {sig_name}. Initiating graceful agent shutdown...")
        self.running = False

    def get_ssl_context(self) -> ssl.SSLContext:
        """Creates SSL context with strict certificate verification."""
        insecure = (
            os.getenv("SMARTPRINT_INSECURE_SSL", "").lower() in ("1", "true", "yes")
            or not self.config.get("verify_ssl", True)
        )
        if insecure:
            logger.warning("INSECURE SSL CONTEXT IN USE: TLS certificate verification is disabled.")
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            return ctx
        return ssl.create_default_context()

    def make_api_request(
        self, endpoint: str, payload: Optional[Dict[str, Any]] = None, method: str = "POST"
    ) -> Dict[str, Any]:
        """Sends authenticated request to Cloud Backend."""
        base_url = self.config["backend_url"].rstrip("/")
        url = f"{base_url}{endpoint}"

        headers = {
            "Content-Type": "application/json",
            "X-Kiosk-Id": self.config.get("kiosk_id", ""),
            "X-Device-Token": self.config.get("device_token", ""),
            "User-Agent": f"GITAM-SmartPrint-Agent/3.0 ({self.config.get('kiosk_id', 'unknown')})"
        }
        if self.config.get("organization_id"):
            headers["X-Organization-Id"] = self.config["organization_id"]

        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        ctx = self.get_ssl_context()

        try:
            with urllib.request.urlopen(req, timeout=20, context=ctx) as resp:
                resp_body = resp.read().decode("utf-8")
                parsed = json.loads(resp_body) if resp_body else {}
                return {
                    "success": True,
                    "status_code": resp.status,
                    "data": parsed,
                }
        except urllib.error.HTTPError as e:
            err_msg = e.read().decode("utf-8") if e.fp else str(e)
            try:
                err_data = json.loads(err_msg)
            except Exception:
                err_data = {"error": err_msg}
            logger.error(f"HTTP Error {e.code} on {endpoint}: {err_data.get('error', err_msg)}")
            return {
                "success": False,
                "status_code": e.code,
                "error": err_data.get("error", err_msg),
                "data": err_data,
            }
        except Exception as e:
            logger.error(f"Network request failed for {endpoint}: {e}")
            return {
                "success": False,
                "status_code": 0,
                "error": str(e),
                "data": {},
            }

    # --------------------------------------------------------------------------
    # Telemetry Heartbeat
    # --------------------------------------------------------------------------
    def send_heartbeat(self) -> None:
        """Sends periodic hardware and printer telemetry to Cloud Backend."""
        if not self.config.get("kiosk_id") or not self.config.get("device_token"):
            return

        cpu_temp, ram_pct, disk_pct = get_system_telemetry()
        hw_model = get_hardware_model() or self.config.get("hardware_model")
        local_ip = get_local_ip() or self.config.get("ip_address")

        # Discover all connected multi-printers (up to 5+)
        printers_telemetry = self.cups.discover_all_printers()

        # Primary printer status
        printer_status, printer_msg = self.cups.get_queue_status()
        if isinstance(printers_telemetry, list) and printers_telemetry and isinstance(printers_telemetry[0], dict):
            default_p = next((p for p in printers_telemetry if isinstance(p, dict) and p.get("is_default")), None)
            if not default_p and isinstance(printers_telemetry[0], dict):
                default_p = printers_telemetry[0]
            if isinstance(default_p, dict) and default_p.get("status"):
                printer_status = default_p.get("status") or printer_status
                printer_msg = default_p.get("last_error") or printer_msg or f"{default_p.get('manufacturer', '')} {default_p.get('model', '')} {printer_status}".strip()

        telemetry = {
            "kiosk_id": self.config["kiosk_id"],
            "agent_version": self.config.get("agent_version", "1.0.0"),
            "printers": printers_telemetry,
        }
        if cpu_temp is not None:
            telemetry["cpu_temp"] = cpu_temp
        if ram_pct is not None:
            telemetry["ram_usage"] = ram_pct
        if disk_pct is not None:
            telemetry["disk_usage"] = disk_pct
        if printer_status:
            telemetry["printer_status"] = printer_status
        if printer_msg:
            telemetry["printer_message"] = printer_msg
        if hw_model:
            telemetry["hardware_model"] = hw_model
        if local_ip:
            telemetry["ip_address"] = local_ip

        res = self.make_api_request("/api/kiosk/heartbeat", payload=telemetry, method="POST")
        if res.get("success"):
            data = res.get("data", {})
            if data.get("routing"):
                self.routing_config = data["routing"]

            temp_str = f"{cpu_temp}°C" if cpu_temp is not None else "N/A"
            ram_str = f"{ram_pct}%" if ram_pct is not None else "N/A"
            disk_str = f"{disk_pct}%" if disk_pct is not None else "N/A"
            pr_count = len(printers_telemetry)
            logger.info(
                f"Heartbeat OK | Model: {hw_model or 'N/A'} | IP: {local_ip or 'N/A'} | "
                f"Printers: {pr_count} active | Temp: {temp_str} | RAM: {ram_str} | Disk: {disk_str} | Primary: {printer_status}"
            )
            if data.get("maintenance_mode"):
                logger.warning("Kiosk is currently in MAINTENANCE MODE.")
        else:
            logger.warning(f"Heartbeat warning (HTTP {res.get('status_code')}): {res.get('error')}")

    # --------------------------------------------------------------------------
    # Startup Crash Recovery Audit
    # --------------------------------------------------------------------------
    def startup_recovery_check(self) -> None:
        """
        Inspects local database on startup to recover safely from unexpected crashes or power loss.
        Never automatically reprints jobs that may have already been printed.
        """
        logger.info("Executing startup crash recovery inspection...")

        # 1. Check jobs that were in active CUPS submission or printing
        active_submitted = self.state_mgr.get_submitted_active_jobs()
        for job in active_submitted:
            job_id = job["job_id"]
            status = job["status"]
            cups_job_id = job.get("cups_job_id")
            cups_queue = job.get("cups_queue") or self.cups.default_queue

            if status in (STATE_SUBMITTED_TO_CUPS, STATE_PRINTING):
                logger.warning(
                    f"CRASH RECOVERY: Found job {job_id} in '{status}' with CUPS ID {cups_job_id}."
                )
                if cups_job_id:
                    # Check CUPS status
                    success, msg = self.cups.wait_for_job_completion(
                        cups_job_id, timeout_seconds=10, queue_name=cups_queue
                    )
                    if success:
                        logger.info(f"CRASH RECOVERY: Job {job_id} confirmed completed in CUPS.")
                        self.state_mgr.transition_status(job_id, STATE_COMPLETED, cups_job_id=cups_job_id)
                        self.state_mgr.enqueue_outbox(
                            job_id, "/api/kiosk/job-complete", {"job_id": job_id, "cups_job_id": cups_job_id}
                        )
                        self.doc_mgr.cleanup_job_workspace(job_id)
                    else:
                        logger.error(
                            f"CRASH RECOVERY: Job {job_id} outcome uncertain ({msg}). "
                            f"Preserving state. Automatic re-print PREVENTED."
                        )
                        self.state_mgr.transition_status(
                            job_id, STATE_OUTCOME_UNCERTAIN, error_message=msg, recovery_reason="Interrupted during printing"
                        )
                        self.state_mgr.enqueue_outbox(
                            job_id, "/api/kiosk/update-status",
                            {"job_id": job_id, "status": "OUTCOME_UNCERTAIN", "error_message": msg}
                        )
                else:
                    self.state_mgr.transition_status(
                        job_id, STATE_CUPS_SUBMISSION_UNCERTAIN, recovery_reason="Missing CUPS ID on reboot"
                    )

            elif status in (STATE_COMPLETED, STATE_CLOUD_COMPLETION_PENDING):
                # Ensure cloud completion is queued in outbox
                logger.info(f"CRASH RECOVERY: Job {job_id} was completed locally. Ensuring outbox delivery...")
                self.state_mgr.enqueue_outbox(
                    job_id, "/api/kiosk/job-complete", {"job_id": job_id, "cups_job_id": cups_job_id}
                )

        # 2. Check jobs interrupted before CUPS submission
        in_flight_pre_cups = self.state_mgr.get_in_flight_jobs()
        for job in in_flight_pre_cups:
            job_id = job["job_id"]
            status = job["status"]
            logger.warning(
                f"CRASH RECOVERY: Found pre-submission job {job_id} in '{status}'. "
                f"Since CUPS was never submitted, safely marking FAILED_BEFORE_SUBMISSION."
            )
            self.state_mgr.transition_status(
                job_id, STATE_FAILED_BEFORE_SUBMISSION, error_message="Interrupted before CUPS submission"
            )
            self.doc_mgr.cleanup_job_workspace(job_id)
            self.state_mgr.enqueue_outbox(
                job_id, "/api/kiosk/update-status",
                {"job_id": job_id, "status": "FAILED", "error_message": "Agent restarted before print submission"}
            )

        # 3. Clean up expired recovery retention files
        purged = self.doc_mgr.cleanup_expired_recovery_files(max_age_hours=24)
        if purged > 0:
            logger.info(f"Cleaned up {purged} expired recovery files (> 24h old).")

    # --------------------------------------------------------------------------
    # Cloud Outbox Delivery Loop
    # --------------------------------------------------------------------------
    def process_outbox(self) -> None:
        """Processes pending cloud outbox tasks with exponential backoff and idempotency."""
        pending_items = self.state_mgr.get_pending_outbox_items(limit=5)
        for item in pending_items:
            outbox_id = item["id"]
            job_id = item["job_id"]
            endpoint = item["endpoint"]
            payload = item["payload"]

            res = self.make_api_request(endpoint, payload=payload, method="POST")
            if res.get("success"):
                logger.info(f"OUTBOX DELIVERED: id={outbox_id} endpoint={endpoint} job={job_id}")
                self.state_mgr.mark_outbox_success(outbox_id)
                if endpoint == "/api/kiosk/job-complete":
                    self.state_mgr.transition_status(job_id, STATE_CLOUD_COMPLETED)
            else:
                err_msg = res.get("error", "Unknown error")
                logger.warning(f"OUTBOX FAILED: id={outbox_id} endpoint={endpoint}: {err_msg}")
                self.state_mgr.mark_outbox_failure(outbox_id, err_msg)

    # --------------------------------------------------------------------------
    # Job Polling & Execution Lifecycle
    # --------------------------------------------------------------------------
    def fetch_and_process_jobs(self) -> None:
        """Polls backend for active verified jobs assigned to this kiosk."""
        if not self.config.get("kiosk_id") or not self.config.get("device_token"):
            return

        res = self.make_api_request(
            "/api/kiosk/poll-jobs",
            payload={"kiosk_id": self.config["kiosk_id"]},
            method="POST"
        )
        if not res.get("success"):
            logger.warning(f"Poll jobs request returned error: {res.get('error')}")
            return

        data = res.get("data", {})
        jobs = data.get("jobs", [])
        if not jobs:
            return

        for job in jobs:
            job_id = job.get("id")
            idempotency_key = job.get("idempotency_key")
            if not job_id:
                continue

            # 1. DUPLICATE PRINT PROTECTION: Check local database before touching anything
            if self.state_mgr.is_job_known(job_id, idempotency_key):
                known_job = self.state_mgr.get_job(job_id) or self.state_mgr.get_job_by_idempotency_key(idempotency_key)
                local_status = known_job["status"] if known_job else "UNKNOWN"

                if local_status in NON_RETRYABLE_PRINT_STATES:
                    logger.warning(
                        f"DUPLICATE GUARD: Job {job_id} already exists locally in state '{local_status}'. "
                        f"Skipping duplicate execution to protect against double-printing."
                    )
                    continue

            # 2. Execute full durable print lifecycle
            self.execute_print_job(job)

    def execute_print_job(self, job: Dict[str, Any]) -> None:
        """
        Durable Print Lifecycle:
        RECEIVED -> RESERVED -> ACKNOWLEDGED -> DOWNLOADING -> PROCESSING ->
        SUBMITTING_TO_CUPS -> SUBMITTED_TO_CUPS -> PRINTING -> COMPLETED -> CLOUD_COMPLETED
        """
        job_id = job["id"]
        idempotency_key = job.get("idempotency_key")
        kiosk_id = self.config["kiosk_id"]
        target_queue = (
            job.get("cups_printer_name")
            or job.get("cups_queue_name")
            or self.cups.default_queue
        )
        # Normalize Pantum queue aliases (e.g. Pantum_M7108DW -> PANTUM_M7100DW)
        if target_queue and "pantum" in target_queue.lower():
            target_queue = "PANTUM_M7100DW"

        logger.info(f"========== STARTING DURABLE PRINT LIFECYCLE: JOB {job_id} ==========")

        # Step A: Atomic SQLite Reservation
        reserved, existing_status = self.state_mgr.reserve_job(
            job_id=job_id,
            idempotency_key=idempotency_key,
            kiosk_id=kiosk_id,
            pages_total=job.get("pages_total", 1),
            pages_selected=job.get("pages_selected", "All"),
            copies=job.get("copies", 1),
            is_color=bool(job.get("is_color", False)),
            is_duplex=bool(job.get("is_duplex", False)),
        )
        if not reserved:
            logger.warning(f"Aborting job {job_id}: reservation rejected (existing status: '{existing_status}')")
            return

        # Step B: Cloud Acknowledgment with Retry
        ack_success = False
        for attempt in range(1, 4):
            ack_res = self.make_api_request("/api/kiosk/update-status", {
                "job_id": job_id,
                "status": "ACKNOWLEDGED",
            })
            if ack_res.get("success"):
                ack_success = True
                break
            logger.warning(f"Cloud ACK attempt {attempt}/3 failed: {ack_res.get('error')}. Retrying...")
            time.sleep(2.0)

        if not ack_success:
            logger.error(f"Cloud ACK permanently failed for job {job_id}. Aborting without submitting to CUPS.")
            self.state_mgr.transition_status(
                job_id, STATE_FAILED_BEFORE_SUBMISSION, error_message="Cloud acknowledgment failed"
            )
            return

        self.state_mgr.transition_status(job_id, STATE_ACKNOWLEDGED)

        # Step C: Transition to DOWNLOADING
        self.state_mgr.transition_status(job_id, STATE_DOWNLOADING)
        self.make_api_request("/api/kiosk/update-status", {
            "job_id": job_id,
            "status": "DOWNLOADING"
        })

        # Step D: Secure Temporary File Download
        raw_download_url = job.get("signed_download_url") or f"/api/kiosk/download/{job_id}"
        download_url = urllib.parse.urljoin(self.config["backend_url"], raw_download_url)
        local_file_path = self.doc_mgr.prepare_job_workspace(job_id)

        try:
            logger.info(f"Downloading temporary document for job {job_id} from {download_url}...")
            ctx = self.get_ssl_context()
            dl_req = urllib.request.Request(
                download_url,
                headers={
                    "X-Kiosk-Id": self.config["kiosk_id"],
                    "X-Device-Token": self.config["device_token"],
                    "User-Agent": f"GITAM-SmartPrint-Agent/3.0 ({self.config['kiosk_id']})",
                }
            )

            with urllib.request.urlopen(dl_req, timeout=30, context=ctx) as resp, open(local_file_path, "wb") as f:
                content = resp.read()
                f.write(content)

            if hasattr(os, "chmod"):
                os.chmod(local_file_path, 0o600)

            # Validate downloaded document (magic bytes, size)
            max_size_mb = self.config.get("max_pdf_size_mb", 50)
            self.cups.validate_document(local_file_path, max_size_mb=max_size_mb)

        except Exception as e:
            err_text = f"Download/validation error for job {job_id}: {e}"
            logger.error(err_text)
            self.state_mgr.transition_status(
                job_id, STATE_FAILED_BEFORE_SUBMISSION, error_message=err_text
            )
            self.make_api_request("/api/kiosk/update-status", {
                "job_id": job_id,
                "status": "FAILED",
                "error_message": str(e)
            })
            self.doc_mgr.cleanup_job_workspace(job_id)
            return

        # Step E: Transition to PROCESSING
        self.state_mgr.transition_status(job_id, STATE_PROCESSING, document_path=local_file_path)
        self.make_api_request("/api/kiosk/update-status", {
            "job_id": job_id,
            "status": "PROCESSING"
        })

        # Step F: Pre-check Queue Readiness & Multi-Printer Failover
        q_status, q_msg = self.cups.get_queue_status(target_queue)
        if q_status in ("STOPPED", "OFFLINE", "ERROR", "PAPER_OUT", "TONER_EMPTY"):
            logger.warning(
                f"Primary queue '{target_queue}' is unavailable ({q_status}: {q_msg}). "
                f"Evaluating multi-printer failover..."
            )

            # Check if auto backup rerouting is permissible
            is_job_color = bool(job.get("is_color", False))
            is_job_duplex = bool(job.get("is_duplex", False))
            backup_queue: Optional[str] = None

            # Query all active discovered printers on kiosk
            discovered = self.cups.discover_all_printers()
            ready_printers = [
                p for p in discovered
                if p.get("cups_queue_name") != target_queue
                and p.get("status") == "READY"
            ]

            if is_job_color:
                # Color jobs require strict color support
                color_ready = [
                    p for p in ready_printers
                    if p.get("supports_color") and (not is_job_duplex or p.get("supports_duplex"))
                ]
                if color_ready:
                    backup_queue = color_ready[0].get("cups_queue_name")
            else:
                # Monochrome jobs prefer mono printers, with safe color printer fallback
                mono_ready = [
                    p for p in ready_printers
                    if not p.get("supports_color") and (not is_job_duplex or p.get("supports_duplex"))
                ]
                if mono_ready:
                    backup_queue = mono_ready[0].get("cups_queue_name")
                elif ready_printers:
                    color_fallback = [
                        p for p in ready_printers
                        if not is_job_duplex or p.get("supports_duplex")
                    ]
                    if color_fallback:
                        backup_queue = color_fallback[0].get("cups_queue_name")

            if backup_queue:
                logger.info(
                    f"FAILOVER TRIGGERED: Rerouted job {job_id} from '{target_queue}' to backup queue '{backup_queue}' "
                    f"(Reason: Primary was {q_status} - {q_msg})"
                )
                self.state_mgr.record_state_history(
                    job_id=job_id,
                    from_state=STATE_PROCESSING,
                    to_state=STATE_PROCESSING,
                    details=f"Failover to {backup_queue} due to primary {target_queue} status {q_status}: {q_msg}"
                )
                self.make_api_request("/api/kiosk/update-status", {
                    "job_id": job_id,
                    "status": "PROCESSING",
                    "message": f"Rerouted to backup queue '{backup_queue}' (Primary '{target_queue}' is {q_status})"
                })
                target_queue = backup_queue
            else:
                err_text = f"Printer queue '{target_queue}' not ready ({q_status}): {q_msg}. No compatible backup printer ready."
                logger.error(err_text)
                self.doc_mgr.preserve_for_recovery(
                    job_id, local_file_path, {"status": q_status, "error": q_msg, "queue": target_queue}
                )
                self.state_mgr.transition_status(
                    job_id, STATE_RECOVERY_REQUIRED, error_message=err_text, recovery_reason=q_status
                )
                self.make_api_request("/api/kiosk/update-status", {
                    "job_id": job_id,
                    "status": "RECOVERY_REQUIRED",
                    "error_message": err_text
                })
                return

        # Step G: CUPS Submission (Exactly Once)
        self.state_mgr.transition_status(job_id, STATE_SUBMITTING_TO_CUPS)

        options = {
            "copies": job.get("copies", 1),
            "pages_selected": job.get("pages_selected", "All"),
            "is_color": bool(job.get("is_color", False)),
            "is_duplex": bool(job.get("is_duplex", False)),
            "orientation": job.get("orientation", "portrait"),
            "paper_size": job.get("paper_size", "A4"),
        }

        cups_job_id: Optional[int] = None
        try:
            cups_job_id = self.cups.submit_print_job(local_file_path, options, queue_name=target_queue)
            logger.info(f"CUPS accepted job {job_id} with verified CUPS Job ID: {cups_job_id}")
        except Exception as e:
            err_text = f"CUPS submission error for job {job_id}: {e}"
            logger.error(err_text)
            # Submission error is uncertain: do NOT reprint blindly!
            self.doc_mgr.preserve_for_recovery(
                job_id, local_file_path, {"error": str(e), "queue": target_queue}
            )
            self.state_mgr.transition_status(
                job_id, STATE_CUPS_SUBMISSION_UNCERTAIN, error_message=err_text, recovery_reason="CUPS submission exception"
            )
            self.make_api_request("/api/kiosk/update-status", {
                "job_id": job_id,
                "status": "OUTCOME_UNCERTAIN",
                "error_message": err_text
            })
            return

        # Record verified submission in local state
        self.state_mgr.transition_status(
            job_id, STATE_SUBMITTED_TO_CUPS, cups_job_id=cups_job_id, cups_queue=target_queue
        )
        self.make_api_request("/api/kiosk/update-status", {
            "job_id": job_id,
            "status": "SUBMITTED_TO_CUPS",
            "cups_job_id": cups_job_id
        })

        # Step H: Transition to PRINTING
        self.state_mgr.transition_status(
            job_id, STATE_PRINTING, cups_job_id=cups_job_id, cups_queue=target_queue
        )
        self.make_api_request("/api/kiosk/update-status", {
            "job_id": job_id,
            "status": "PRINTING",
            "cups_job_id": cups_job_id
        })

        # Step I: Monitor Completion
        timeout_sec = self.config.get("job_timeout_seconds", 120)
        success, status_msg = self.cups.wait_for_job_completion(
            cups_job_id, timeout_seconds=timeout_sec, queue_name=target_queue
        )

        if success:
            logger.info(f"CUPS Job {cups_job_id} for job {job_id} verified COMPLETED!")
            self.state_mgr.transition_status(
                job_id, STATE_COMPLETED, cups_job_id=cups_job_id, cups_queue=target_queue
            )

            # Enqueue cloud completion report to outbox
            self.state_mgr.enqueue_outbox(
                job_id,
                "/api/kiosk/job-complete",
                {"job_id": job_id, "cups_job_id": cups_job_id}
            )

            # Attempt immediate outbox dispatch
            self.process_outbox()

            # Destroy local temporary document
            self.doc_mgr.cleanup_job_workspace(job_id)
            logger.info(f"CLEANUP VERIFIED: Local temporary files destroyed for completed job {job_id}")

        else:
            logger.error(f"Print failed or uncertain for job {job_id}: {status_msg}")
            is_timeout = "timed out" in status_msg.lower()
            outcome_status = STATE_OUTCOME_UNCERTAIN if is_timeout else STATE_RECOVERY_REQUIRED

            # Move file to recovery folder - do NOT delete it!
            self.doc_mgr.preserve_for_recovery(
                job_id, local_file_path, {
                    "cups_job_id": cups_job_id,
                    "queue": target_queue,
                    "error": status_msg,
                }
            )

            self.state_mgr.transition_status(
                job_id, outcome_status, cups_job_id=cups_job_id, error_message=status_msg
            )

            cloud_status = "OUTCOME_UNCERTAIN" if is_timeout else "RECOVERY_REQUIRED"
            self.state_mgr.enqueue_outbox(
                job_id,
                "/api/kiosk/update-status",
                {
                    "job_id": job_id,
                    "status": cloud_status,
                    "error_message": status_msg,
                    "cups_job_id": cups_job_id
                }
            )
            self.process_outbox()

    def _wait_for_network_and_initial_heartbeat(self, max_wait_sec: int = 25) -> None:
        """
        On boot or service startup, waits for network connection to become available
        and sends the first heartbeat IMMEDIATELY so kiosk status is online without delay.
        """
        logger.info("Checking network connectivity on boot...")
        start_time = time.time()
        connected = False

        while (time.time() - start_time) < max_wait_sec and self.running:
            try:
                base_url = self.config.get("backend_url", DEFAULT_BACKEND_URL).rstrip("/")
                health_url = f"{base_url}/api/health"
                req = urllib.request.Request(
                    health_url,
                    headers={"User-Agent": f"GITAM-SmartPrint-Agent/3.0 ({self.config.get('kiosk_id', 'unknown')})"}
                )
                ctx = self.get_ssl_context()
                with urllib.request.urlopen(req, timeout=2.5, context=ctx) as resp:
                    if resp.status < 500:
                        connected = True
                        break
            except Exception:
                time.sleep(1.0)

        if connected:
            logger.info("Network is active. Emitting immediate boot heartbeat...")
        else:
            logger.warning(f"Network probe timed out after {max_wait_sec}s. Proceeding with agent startup...")

        try:
            self.send_heartbeat()
        except Exception as e:
            logger.warning(f"Initial boot heartbeat warning: {e}")

    # --------------------------------------------------------------------------
    # Main Agent Run Loop
    # --------------------------------------------------------------------------
    def run(self) -> None:
        """Main service daemon loop."""
        logger.info(f"Starting GITAM SMARTPRINT Agent v3.0 (Kiosk: {self.config.get('kiosk_id')})...")
        logger.info(f"Backend Target: {self.config.get('backend_url')}")
        logger.info(f"Default CUPS Queue: {self.config.get('cups_queue')}")

        if not self.state_mgr.acquire_process_lock():
            logger.critical("Another smartprint-agent instance is already running. Exiting.")
            sys.exit(1)

        try:
            # Run startup crash recovery audit
            self.startup_recovery_check()

            # Fast network readiness check & immediate initial heartbeat
            self._wait_for_network_and_initial_heartbeat()

            last_heartbeat = time.time()
            last_outbox_check = 0.0
            last_cleanup_check = time.time()

            hb_interval = self.config.get("heartbeat_interval_sec", 10)
            poll_interval = self.config.get("poll_interval_sec", 1.5)
            outbox_interval = self.config.get("outbox_interval_sec", 2)

            while self.running:
                now = time.time()

                # 1. Telemetry Heartbeat
                if now - last_heartbeat >= hb_interval:
                    try:
                        self.send_heartbeat()
                    except Exception as e:
                        logger.error(f"Heartbeat loop exception: {e}")
                    last_heartbeat = now

                # 2. Cloud Outbox Retries
                if now - last_outbox_check >= outbox_interval:
                    try:
                        self.process_outbox()
                    except Exception as e:
                        logger.error(f"Outbox loop exception: {e}")
                    last_outbox_check = now

                # 3. FIFO Print Job Polling & Execution
                try:
                    self.fetch_and_process_jobs()
                except Exception as e:
                    logger.error(f"Job polling loop exception: {e}")

                # 4. Hourly Bounded Retention Cleanup
                if now - last_cleanup_check >= 3600:
                    try:
                        purged = self.doc_mgr.cleanup_expired_recovery_files(max_age_hours=24)
                        cleaned = self.doc_mgr.cleanup_stale_active_workspaces(max_age_minutes=60)
                        if purged > 0 or cleaned > 0:
                            logger.info(f"Hourly maintenance: purged={purged} expired recovery files, cleaned={cleaned} stale workspaces.")
                    except Exception as e:
                        logger.error(f"Maintenance cleanup exception: {e}")
                    last_cleanup_check = now

                time.sleep(poll_interval)

        finally:
            logger.info("SmartPrint Agent stopping. Releasing process lock.")
            self.state_mgr.release_process_lock()


if __name__ == "__main__":
    agent = SmartPrintAgent()
    agent.run()
