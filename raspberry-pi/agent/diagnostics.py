#!/usr/bin/env python3
"""
GITAM SMARTPRINT - System Health & Diagnostic Tool
Provides non-destructive health checks for:
- Internet connectivity
- Cloud Backend reachability
- CUPS service & HP Laser 108w queue state
- IPP-USB daemon & endpoint
- SQLite database integrity & permissions
- Storage availability & CPU temperature
- Agent daemon process status
- Pending cloud outbox reports
- Unresolved recovery jobs

Does NOT submit test prints or alter customer jobs.
"""

import os
import sys
import json
import socket
import urllib.request
import subprocess
from typing import Dict, Any

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from state_manager import StateManager
from cups_controller import CupsController, DEFAULT_QUEUE_NAME
from smartprint_agent import load_config, get_system_telemetry, get_hardware_model, get_local_ip


def check_power_undervoltage() -> tuple:
    """
    Checks Raspberry Pi power input status using vcgencmd get_throttled.
    Returns (status, details) where status is 'PASS', 'WARN', or 'FAIL'.
    Bit 0 (0x1): Active under-voltage currently detected (<4.63V)
    Bit 1 (0x2): Arm frequency currently capped
    Bit 2 (0x4): Currently throttled
    Bit 16 (0x10000): Under-voltage has occurred since boot
    Bit 18 (0x40000): Throttling has occurred since boot
    """
    try:
        res = subprocess.check_output(
            ["vcgencmd", "get_throttled"],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=2.0
        ).strip()
        if "=" in res:
            hex_str = res.split("=")[1].strip()
            val = int(hex_str, 16)
            if val == 0:
                return "PASS", "Power supply stable (5.1V nominal, throttled=0x0)"

            issues = []
            status = "WARN"
            if val & 0x1:
                status = "FAIL"
                issues.append("ACTIVE UNDER-VOLTAGE (< 4.63V)")
            elif val & 0x10000:
                issues.append("Under-voltage occurred since boot")

            if val & 0x2:
                status = "FAIL"
                issues.append("ARM frequency actively capped")
            if val & 0x4:
                status = "FAIL"
                issues.append("Actively throttled")
            if val & 0x40000:
                issues.append("Throttling occurred since boot")

            msg = f"Code {hex_str}: {', '.join(issues)}. Recommend official 5.1V 3A USB-C PSU."
            return status, msg
    except FileNotFoundError:
        pass
    except Exception:
        pass

    try:
        dmesg = subprocess.check_output(
            ["dmesg"],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=2.0
        )
        if "Under-voltage detected" in dmesg:
            return "WARN", "Under-voltage logged in dmesg. Check power adapter and USB-C cable."
    except Exception:
        pass

    return "PASS", "Power voltage nominal (no throttling or undervoltage detected)"


def run_diagnostics(as_json: bool = False) -> Dict[str, Any]:
    """Runs all non-destructive diagnostics and returns structured report."""
    report: Dict[str, Any] = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "kiosk_id": "UNKNOWN",
        "checks": {},
        "summary": {"pass": 0, "warn": 0, "fail": 0},
    }

    def record_check(name: str, status: str, details: Any):
        report["checks"][name] = {"status": status, "details": details}
        report["summary"][status.lower()] += 1

    config = load_config()
    report["kiosk_id"] = config.get("kiosk_id", "UNKNOWN")
    report["hardware_model"] = get_hardware_model() or "N/A"
    report["local_ip"] = get_local_ip() or "N/A"

    # 1. Internet Connectivity
    try:
        s = socket.create_connection(("8.8.8.8", 53), timeout=3.0)
        s.close()
        record_check("internet_connectivity", "PASS", "Gateway reachable (8.8.8.8:53)")
    except Exception as e:
        record_check("internet_connectivity", "FAIL", f"Internet unreachable: {e}")

    # 2. Cloud Backend API Reachability
    backend_url = config.get("backend_url", "https://smart-prints.vercel.app").rstrip("/")
    health_url = f"{backend_url}/api/health"
    try:
        req = urllib.request.Request(health_url, headers={"User-Agent": "SmartPrint-Diag/3.0"})
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            record_check("backend_api", "PASS", f"Connected to {backend_url} (HTTP {resp.status})")
    except Exception as e:
        record_check("backend_api", "FAIL", f"Cannot reach {health_url}: {e}")

    # 3. Multi-Printer & CUPS Queues Availability
    cups_ctrl = CupsController(default_queue=config.get("cups_queue", DEFAULT_QUEUE_NAME))
    discovered_printers = cups_ctrl.discover_all_printers()
    if discovered_printers:
        ready_count = sum(1 for p in discovered_printers if p.get("status") in ("READY", "PRINTING", "BUSY"))
        summary = f"{len(discovered_printers)} printer(s) discovered ({ready_count} READY): " + ", ".join(
            f"{p['cups_queue_name']}={p['status']}" for p in discovered_printers
        )
        if ready_count > 0:
            record_check("cups_multi_printers", "PASS", summary)
        else:
            record_check("cups_multi_printers", "WARN", summary)
    else:
        q_name = cups_ctrl.default_queue
        q_status, q_msg = cups_ctrl.get_queue_status(q_name)
        if q_status == "READY":
            record_check("cups_queue", "PASS", f"Default queue '{q_name}' is READY ({q_msg})")
        else:
            record_check("cups_queue", "WARN", f"Default queue '{q_name}': {q_status} ({q_msg})")

    # 4. IPP-USB Service
    try:
        res = subprocess.check_output(["systemctl", "is-active", "ipp-usb"], text=True, stderr=subprocess.DEVNULL).strip()
        if res == "active":
            record_check("ipp_usb_service", "PASS", "ipp-usb.service is active and running")
        else:
            record_check("ipp_usb_service", "WARN", f"ipp-usb.service status: {res}")
    except Exception:
        # Check if local port 60000 is open
        try:
            s = socket.create_connection(("127.0.0.1", 60000), timeout=1.0)
            s.close()
            record_check("ipp_usb_service", "PASS", "ipp-usb daemon listening on 127.0.0.1:60000")
        except Exception:
            record_check("ipp_usb_service", "WARN", "ipp-usb service not active or unmonitored")

    # 5. SQLite Database Integrity
    state_mgr = StateManager()
    try:
        with state_mgr._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("PRAGMA integrity_check;")
            row = cursor.fetchone()
            check_result = row[0] if row else "unknown"
            if check_result.lower() == "ok":
                record_check("database_integrity", "PASS", f"SQLite integrity OK ({state_mgr.db_path})")
            else:
                record_check("database_integrity", "FAIL", f"SQLite corruption detected: {check_result}")
    except Exception as e:
        record_check("database_integrity", "FAIL", f"Cannot connect to SQLite DB: {e}")

    # 6. Disk Free Space
    cpu_temp, ram_pct, disk_pct = get_system_telemetry()
    try:
        import shutil
        total, used, free = shutil.disk_usage(state_mgr.state_dir)
        free_mb = free / (1024 * 1024)
        if free_mb > 1000:
            record_check("disk_space", "PASS", f"{free_mb:.0f} MB available on {state_mgr.state_dir}")
        elif free_mb > 200:
            record_check("disk_space", "WARN", f"Low disk space: {free_mb:.0f} MB available")
        else:
            record_check("disk_space", "FAIL", f"Critical: only {free_mb:.0f} MB free")
    except Exception as e:
        record_check("disk_space", "WARN", f"Could not determine disk usage: {e}")

    # 7. CPU Temperature & Power Supply Health
    if cpu_temp is not None:
        if cpu_temp < 75.0:
            record_check("cpu_temperature", "PASS", f"{cpu_temp}°C (within normal operating range)")
        elif cpu_temp < 82.0:
            record_check("cpu_temperature", "WARN", f"{cpu_temp}°C (elevated temperature, monitor cooling)")
        else:
            record_check("cpu_temperature", "FAIL", f"{cpu_temp}°C (thermal throttling risk)")
    else:
        record_check("cpu_temperature", "WARN", "Thermal sensor unavailable")

    # 7.5 Power Supply & Undervoltage Health
    power_status, power_details = check_power_undervoltage()
    record_check("power_voltage_health", power_status, power_details)

    # 8. Agent Process Lock / Daemon Status
    lock_file = state_mgr.lock_file_path
    if os.path.exists(lock_file):
        try:
            with open(lock_file, "r") as f:
                pid_str = f.read().strip()
                pid = int(pid_str)
                # Check if process is alive
                os.kill(pid, 0)
                record_check("agent_daemon", "PASS", f"SmartPrint agent process running (PID {pid})")
        except ProcessLookupError:
            record_check("agent_daemon", "WARN", f"Stale lock file found for PID {pid_str}")
        except Exception as e:
            record_check("agent_daemon", "WARN", f"Agent lock check warning: {e}")
    else:
        record_check("agent_daemon", "WARN", "No agent lock file found (agent may not be running)")

    # 9. Pending Cloud Outbox Reports
    outbox_summary = state_mgr.get_outbox_summary()
    pending_count = outbox_summary.get("pending", 0)
    failed_count = outbox_summary.get("failed", 0)
    if pending_count == 0 and failed_count == 0:
        record_check("cloud_outbox", "PASS", "All cloud reports synchronized (0 pending)")
    elif failed_count > 0:
        record_check("cloud_outbox", "WARN", f"{pending_count} pending, {failed_count} failed outbox items")
    else:
        record_check("cloud_outbox", "PASS", f"{pending_count} pending report(s) in delivery queue")

    # 10. Recovery-Required Jobs
    recovery_jobs = state_mgr.get_unresolved_recovery_jobs()
    if not recovery_jobs:
        record_check("recovery_jobs", "PASS", "No jobs requiring administrator recovery")
    else:
        rec_ids = [j["job_id"] for j in recovery_jobs[:5]]
        record_check(
            "recovery_jobs",
            "WARN",
            f"{len(recovery_jobs)} job(s) requiring review: {', '.join(rec_ids)}"
        )

    return report


def print_cli_report(report: Dict[str, Any]):
    """Outputs human-readable colorized terminal report."""
    GREEN = "\033[0;32m"
    YELLOW = "\033[1;33m"
    RED = "\033[0;31m"
    BOLD = "\033[1m"
    NC = "\033[0m"

    print("=" * 60)
    print(f"{BOLD}GITAM SMARTPRINT - SYSTEM HEALTH & DIAGNOSTICS REPORT{NC}")
    print(f"Kiosk ID:       {report['kiosk_id']}")
    print(f"Hardware Model: {report.get('hardware_model', 'N/A')}")
    print(f"Local IP:       {report.get('local_ip', 'N/A')}")
    print(f"Timestamp:      {report['timestamp']}")
    print("=" * 60)

    for name, data in report["checks"].items():
        st = data["status"]
        if st == "PASS":
            badge = f"[{GREEN} PASS {NC}]"
        elif st == "WARN":
            badge = f"[{YELLOW} WARN {NC}]"
        else:
            badge = f"[{RED} FAIL {NC}]"
        label = name.replace("_", " ").title()
        print(f"  {badge} {label:<26}: {data['details']}")

    summary = report["summary"]
    print("=" * 60)
    print(
        f"Summary: {GREEN}{summary['pass']} PASS{NC} | "
        f"{YELLOW}{summary['warn']} WARN{NC} | "
        f"{RED}{summary['fail']} FAIL{NC}"
    )

    if summary["fail"] == 0:
        print(f"{GREEN}✓ SYSTEM READY FOR PRODUCTION PRINTING{NC}")
    else:
        print(f"{RED}⚠ ACTION REQUIRED: Address failing checks above before operation{NC}")
    print("=" * 60)


if __name__ == "__main__":
    import time
    as_json = "--json" in sys.argv
    rep = run_diagnostics(as_json=as_json)
    if as_json:
        print(json.dumps(rep, indent=2))
    else:
        print_cli_report(rep)
    sys.exit(1 if rep["summary"]["fail"] > 0 else 0)
