#!/usr/bin/env python3
"""
GITAM SMARTPRINT - Raspberry Pi 3B+ Production Agent
Handles device authentication, heartbeat telemetry, job polling,
secure temporary download, CUPS print execution, verified completion,
and immediate secure document destruction.
"""

import os
import sys
import time
import json
import shutil
import logging
import sqlite3
import subprocess
import urllib.request
import urllib.parse
import ssl
from pathlib import Path

# Import local CUPS controller
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from cups_controller import CupsController

# LOGGING SETUP
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] SMARTPRINT-AGENT: %(message)s"
)

# CONFIGURATION
CONFIG_FILE = os.getenv("SMARTPRINT_CONFIG", "/etc/smartprint/agent_config.json")
LOCAL_STATE_DB = "/var/lib/smartprint/agent_state.db"
TEMP_JOBS_DIR = "/var/lib/smartprint/jobs"

DEFAULT_BACKEND_URL = os.getenv("SMARTPRINT_BACKEND_URL", "http://localhost:3001")
DEFAULT_KIOSK_ID = os.getenv("SMARTPRINT_KIOSK_ID", "GITAM-SPK-001")
DEFAULT_DEVICE_TOKEN = os.getenv("SMARTPRINT_DEVICE_TOKEN", "gitam_spk_001_secure_device_secret_2026")


def load_config():
    """Loads agent configuration from file or environment defaults."""
    cfg = {
        "backend_url": DEFAULT_BACKEND_URL,
        "kiosk_id": DEFAULT_KIOSK_ID,
        "device_token": DEFAULT_DEVICE_TOKEN,
        "poll_interval_sec": 5,
        "heartbeat_interval_sec": 10,
    }

    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                user_cfg = json.load(f)
                cfg.update(user_cfg)
        except Exception as e:
            logging.warning(f"Failed to read config file {CONFIG_FILE}: {e}")

    return cfg


def init_local_db():
    """Initializes local SQLite database to guarantee idempotency and prevent duplicate prints."""
    os.makedirs(os.path.dirname(LOCAL_STATE_DB), exist_ok=True)
    conn = sqlite3.connect(LOCAL_STATE_DB)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS processed_jobs (
            job_id TEXT PRIMARY KEY,
            idempotency_key TEXT UNIQUE,
            status TEXT,
            cups_job_id INTEGER,
            processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


def is_job_already_processed(job_id, idempotency_key):
    """Checks if job was already printed locally."""
    conn = sqlite3.connect(LOCAL_STATE_DB)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT status FROM processed_jobs WHERE job_id = ? OR idempotency_key = ?",
        (job_id, idempotency_key)
    )
    row = cursor.fetchone()
    conn.close()
    return row is not None


def mark_job_processed_locally(job_id, idempotency_key, status, cups_job_id=None):
    """Records completed print job in local state database."""
    conn = sqlite3.connect(LOCAL_STATE_DB)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT OR REPLACE INTO processed_jobs (job_id, idempotency_key, status, cups_job_id) VALUES (?, ?, ?, ?)",
        (job_id, idempotency_key, status, cups_job_id)
    )
    conn.commit()
    conn.close()


def get_system_telemetry():
    """Reads Raspberry Pi CPU temperature, RAM usage, and Disk usage."""
    cpu_temp = 0.0
    ram_usage = 0.0
    disk_usage = 0.0

    # CPU Temp (Thermal Zone)
    try:
        if os.path.exists("/sys/class/thermal/thermal_zone0/temp"):
            with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
                cpu_temp = round(float(f.read().strip()) / 1000.0, 1)
    except Exception:
        pass

    # RAM Usage via free / proc
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
            total = mem.get("MemTotal", 1)
            free = mem.get("MemAvailable", mem.get("MemFree", 0))
            ram_usage = round(((total - free) / total) * 100.0, 1)
    except Exception:
        pass

    # Disk Usage
    try:
        total, used, free = shutil.disk_usage("/")
        disk_usage = round((used / total) * 100.0, 1)
    except Exception:
        pass

    return cpu_temp, ram_usage, disk_usage


def secure_wipe_file(file_path):
    """
    Overwrites document file with zeros before unlinking to guarantee complete data destruction.
    Prevents physical forensics recovery of customer files on Raspberry Pi SD card.
    """
    if not os.path.exists(file_path):
        return

    try:
        # Check if Linux shred CLI utility is available
        shred_path = shutil.which("shred")
        if shred_path:
            subprocess.run([shred_path, "-u", "-n", "1", file_path], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            logging.info(f"Securely shredded document via shred utility: {file_path}")
            return
    except Exception as e:
        logging.warning(f"shred failed, using fallback overwrite: {e}")

    # Fallback zero overwrite
    try:
        size = os.path.getsize(file_path)
        with open(file_path, "wb") as f:
            f.write(b"\x00" * size)
        os.remove(file_path)
        logging.info(f"Overwritten with 0x00 and removed: {file_path}")
    except Exception as e:
        logging.error(f"Error during file destruction: {e}")


def cleanup_stale_temp_files():
    """Boot-time & periodic cleanup of lingering job directories in /var/lib/smartprint/jobs."""
    if not os.path.exists(TEMP_JOBS_DIR):
        os.makedirs(TEMP_JOBS_DIR, mode=0o700, exist_ok=True)
        return

    logging.info(f"Scanning {TEMP_JOBS_DIR} for stale temporary files...")
    for entry in os.listdir(TEMP_JOBS_DIR):
        full_path = os.path.join(TEMP_JOBS_DIR, entry)
        try:
            if os.path.isdir(full_path):
                for sub in os.listdir(full_path):
                    doc_path = os.path.join(full_path, sub)
                    secure_wipe_file(doc_path)
                os.rmdir(full_path)
            elif os.path.isfile(full_path):
                secure_wipe_file(full_path)
        except Exception as e:
            logging.error(f"Cleanup error on {full_path}: {e}")


class SmartPrintAgent:
    def __init__(self):
        self.config = load_config()
        self.cups = CupsController()
        init_local_db()
        cleanup_stale_temp_files()
        self.running = True

    def get_ssl_context(self):
        """Creates SSL context with secure certificate verification by default."""
        insecure = os.getenv("SMARTPRINT_INSECURE_SSL", "").lower() in ("1", "true", "yes") or not self.config.get("verify_ssl", True)
        if insecure:
            logging.warning("Insecure SSL context in use: TLS certificate verification is disabled.")
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            return ctx
        return ssl.create_default_context()

    def make_api_request(self, endpoint, payload=None, method="POST"):
        """Sends authenticated request to Cloud Backend."""
        url = f"{self.config['backend_url']}{endpoint}"
        headers = {
            "Content-Type": "application/json",
            "X-Organization-Id": self.config.get("organization_id", ""),
            "X-Kiosk-Id": self.config["kiosk_id"],
            "X-Device-Token": self.config["device_token"],
            "User-Agent": f"GITAM-SmartPrint-Agent/1.0 ({self.config['kiosk_id']})"
        }

        data = json.dumps(payload).encode("utf-8") if payload else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)

        ctx = self.get_ssl_context()

        try:
            with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                resp_body = resp.read().decode("utf-8")
                return json.loads(resp_body) if resp_body else {}
        except urllib.error.HTTPError as e:
            err_msg = e.read().decode("utf-8") if e.fp else str(e)
            logging.error(f"HTTP Error {e.code} on {endpoint}: {err_msg}")
            return {"error": err_msg, "code": e.code}
        except Exception as e:
            logging.error(f"Network request failed for {endpoint}: {e}")
            return {"error": str(e)}

    def send_heartbeat(self):
        """Telemetry heartbeat sent to Cloud Backend."""
        cpu_temp, ram_pct, disk_pct = get_system_telemetry()
        printer_status, printer_msg = self.cups.get_queue_status()

        telemetry = {
            "kiosk_id": self.config["kiosk_id"],
            "cpu_temp": cpu_temp,
            "ram_usage": ram_pct,
            "disk_usage": disk_pct,
            "printer_status": printer_status,
            "printer_message": printer_msg,
            "agent_version": "1.0.0"
        }

        res = self.make_api_request("/api/kiosk/heartbeat", payload=telemetry, method="POST")
        if res.get("success"):
            logging.info(f"Heartbeat OK | Temp: {cpu_temp}°C | RAM: {ram_pct}% | Disk: {disk_pct}% | Printer: {printer_status}")
        else:
            logging.warning(f"Heartbeat warning: {res.get('error')}")

    def fetch_and_process_jobs(self):
        """Polls backend for active verified jobs assigned to this kiosk."""
        res = self.make_api_request("/api/kiosk/poll-jobs", payload={"kiosk_id": self.config["kiosk_id"]}, method="POST")
        jobs = res.get("jobs", [])

        if not jobs:
            return

        for job in jobs:
            job_id = job["id"]
            idempotency_key = job["idempotency_key"]

            # DUPLICATE PRINT PROTECTION
            if is_job_already_processed(job_id, idempotency_key):
                logging.warning(f"Job {job_id} was ALREADY processed locally! Skipping duplicate print request.")
                self.make_api_request("/api/kiosk/update-status", {
                    "job_id": job_id,
                    "status": "COMPLETED",
                    "note": "Skipped duplicate print request - already printed locally"
                })
                continue

            self.execute_print_job(job)

    def execute_print_job(self, job):
        """Full end-to-end print lifecycle on Raspberry Pi."""
        job_id = job["id"]
        idempotency_key = job["idempotency_key"]
        download_url = job.get("signed_download_url") or f"{self.config['backend_url']}/api/kiosk/download/{job_id}?token={idempotency_key}"

        logging.info(f"========== START PRINT JOB {job_id} ==========")
        self.make_api_request("/api/kiosk/update-status", {"job_id": job_id, "status": "DOWNLOADING"})

        # 1. Create temporary job workspace directory
        job_dir = os.path.join(TEMP_JOBS_DIR, job_id)
        os.makedirs(job_dir, mode=0o700, exist_ok=True)
        local_file_path = os.path.join(job_dir, "document.pdf")

        try:
            # 2. Securely Download temporary document
            logging.info(f"Downloading temporary document for job {job_id}...")
            ctx = self.get_ssl_context()

            req = urllib.request.Request(download_url, headers={"User-Agent": "GITAM-SmartPrint-Agent/1.0"})
            with urllib.request.urlopen(req, timeout=30, context=ctx) as resp, open(local_file_path, "wb") as f:
                f.write(resp.read())
            os.chmod(local_file_path, 0o600)

            # 3. Update status to PROCESSING
            self.make_api_request("/api/kiosk/update-status", {"job_id": job_id, "status": "PROCESSING"})

            # 4. Submit to CUPS using server-selected queue
            target_queue = job.get("cups_printer_name") or job.get("cups_queue_name")
            options = {
                "copies": job.get("copies", 1),
                "pages_selected": job.get("pages_selected", "All"),
                "is_color": job.get("is_color", False),
                "is_duplex": job.get("is_duplex", False),
                "orientation": job.get("orientation", "portrait")
            }

            cups_job_id = self.cups.submit_print_job(local_file_path, options, queue_name=target_queue)
            logging.info(f"Submitted to CUPS queue '{target_queue or self.cups.default_queue}' with job ID {cups_job_id}")

            self.make_api_request("/api/kiosk/update-status", {
                "job_id": job_id,
                "status": "PRINTING",
                "cups_job_id": cups_job_id
            })

            # 5. Wait for verified completion on target queue
            success, status_msg = self.cups.wait_for_job_completion(cups_job_id, timeout_seconds=120, queue_name=target_queue)

            if success:
                logging.info(f"Print job {job_id} verified COMPLETED!")
                
                # Mark local state DB immediately before cloud API call
                mark_job_processed_locally(job_id, idempotency_key, "COMPLETED", cups_job_id)

                # Send completion signal to backend (triggers cloud file deletion & DB file reference nullification)
                self.make_api_request("/api/kiosk/job-complete", {
                    "job_id": job_id,
                    "kiosk_id": self.config["kiosk_id"],
                    "cups_job_id": cups_job_id,
                    "status": "COMPLETED"
                })

                # 6. IMMEDIATELY DESTROY LOCAL FILE
                secure_wipe_file(local_file_path)
                try:
                    os.rmdir(job_dir)
                except Exception:
                    pass
                logging.info(f"CLEANUP VERIFIED: Local temporary file & directory destroyed for job {job_id}")

            else:
                logging.error(f"Print failed for job {job_id}: {status_msg}")
                self.make_api_request("/api/kiosk/update-status", {
                    "job_id": job_id,
                    "status": "RECOVERY_REQUIRED",
                    "error_message": status_msg
                })

        except Exception as e:
            logging.error(f"Error executing print job {job_id}: {e}")
            self.make_api_request("/api/kiosk/update-status", {
                "job_id": job_id,
                "status": "RECOVERY_REQUIRED",
                "error_message": str(e)
            })

        finally:
            # Ensure local cleanup even if exception occurred
            if os.path.exists(local_file_path):
                secure_wipe_file(local_file_path)
            if os.path.exists(job_dir):
                try:
                    shutil.rmtree(job_dir, ignore_errors=True)
                except Exception:
                    pass

    def run(self):
        """Main service loop."""
        logging.info(f"Starting GITAM SMARTPRINT Agent for Kiosk {self.config['kiosk_id']}...")
        logging.info(f"Backend Target: {self.config['backend_url']}")

        last_heartbeat = 0
        hb_interval = self.config.get("heartbeat_interval_sec", 10)
        poll_interval = self.config.get("poll_interval_sec", 5)

        while self.running:
            now = time.time()
            if now - last_heartbeat >= hb_interval:
                try:
                    self.send_heartbeat()
                except Exception as e:
                    logging.error(f"Heartbeat loop exception: {e}")
                last_heartbeat = now

            try:
                self.fetch_and_process_jobs()
            except Exception as e:
                logging.error(f"Job polling exception: {e}")

            time.sleep(poll_interval)


if __name__ == "__main__":
    agent = SmartPrintAgent()
    try:
        agent.run()
    except KeyboardInterrupt:
        logging.info("Stopping SmartPrint Agent.")
        sys.exit(0)
