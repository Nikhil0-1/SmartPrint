#!/usr/bin/env python3
"""
GITAM SMARTPRINT - Raspberry Pi CUPS Controller
Manages USB HP Printer queue, print submission, status tracking, and printer discovery.
Uses pycups if available, with robust fallback to Linux lp/lpstat system utilities.
"""

import os
import subprocess
import logging
import json
import time

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] CUPS: %(message)s")

try:
    import cups
    HAS_PYCUPS = True
except ImportError:
    HAS_PYCUPS = False
    logging.warning("pycups library not installed. Falling back to subprocess lp/lpstat CLI tool calls.")


class CupsController:
    def __init__(self, default_queue=None):
        self.default_queue = default_queue or os.getenv("SMARTPRINT_CUPS_QUEUE", "Pantum_M7108DW")
        if HAS_PYCUPS:
            try:
                self.conn = cups.Connection()
            except Exception as e:
                logging.error(f"Failed to connect to CUPS daemon via pycups: {e}")
                self.conn = None
        else:
            self.conn = None

    @staticmethod
    def detect_usb_printers():
        """Discovers USB printers connected to Raspberry Pi via lsusb and CUPS lpinfo."""
        printers = []
        try:
            # Check USB bus devices
            usb_out = subprocess.check_output(["lsusb"], text=True, stderr=subprocess.DEVNULL)
            hp_found = "Hewlett-Packard" in usb_out or "HP" in usb_out
            pantum_found = "Pantum" in usb_out or "2327:" in usb_out
            
            # Check CUPS detected devices
            lpinfo_out = subprocess.check_output(["lpinfo", "-v"], text=True, stderr=subprocess.DEVNULL)
            for line in lpinfo_out.splitlines():
                if "usb://" in line:
                    uri = line.split()[-1]
                    mfg = "Pantum" if ("pantum" in uri.lower() or pantum_found) else ("HP" if hp_found else "Generic USB")
                    printers.append({
                        "uri": uri,
                        "connection": "USB",
                        "manufacturer": mfg,
                        "pantum_hardware_detected": pantum_found,
                        "hp_hardware_detected": hp_found
                    })
        except Exception as e:
            logging.error(f"Error executing printer detection CLI: {e}")

        return printers

    def get_queue_status(self, queue_name=None):
        """Returns printer status: READY, BUSY, ERROR, PAPER_OUT, OFFLINE, or UNKNOWN."""
        target_queue = queue_name or self.default_queue

        if HAS_PYCUPS and self.conn:
            try:
                printers = self.conn.getPrinters()
                if target_queue in printers:
                    p_info = printers[target_queue]
                    state = p_info.get('printer-state', 3) # 3: idle, 4: processing, 5: stopped
                    reasons = p_info.get('printer-state-reasons', [])
                    
                    if state == 3:
                        return "READY", "Printer idle and ready"
                    elif state == 4:
                        return "BUSY", "Printing in progress"
                    elif state == 5:
                        reason_str = ", ".join(reasons) if reasons else "Printer stopped"
                        if "media-empty" in reason_str:
                            return "PAPER_OUT", "Paper tray is empty"
                        return "ERROR", f"Printer error: {reason_str}"
                else:
                    return "OFFLINE", f"Queue '{target_queue}' not configured in CUPS"
            except Exception as e:
                logging.error(f"pycups status check failed: {e}")

        # Fallback to lpstat
        try:
            cmd = ["lpstat", "-p", target_queue]
            out = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT)
            if "disabled" in out or "stopped" in out:
                return "ERROR", out.strip()
            elif "is printing" in out or "busy" in out:
                return "BUSY", "Printing in progress"
            elif "idle" in out or "ready" in out:
                return "READY", "Printer ready"
        except subprocess.CalledProcessError as e:
            if "unknown printer" in e.output.lower() or "does not exist" in e.output.lower():
                return "OFFLINE", f"Queue '{target_queue}' not found in CUPS"
            return "ERROR", e.output.strip()
        except Exception as e:
            return "OFFLINE", f"CUPS service unavailable: {e}"

        return "OFFLINE", f"No verified status available for queue '{target_queue}'"

    def submit_print_job(self, file_path, options, queue_name=None):
        """
        Submits a PDF file to CUPS with options:
        - copies: integer (1-10)
        - pages: string range e.g. "1-3" or "All"
        - is_color: boolean
        - is_duplex: boolean
        - orientation: 'portrait' / 'landscape'
        """
        target_queue = queue_name or self.default_queue

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Print payload file not found: {file_path}")

        copies = options.get("copies", 1)
        pages = options.get("pages_selected", "All")
        is_color = options.get("is_color", False)
        is_duplex = options.get("is_duplex", False)
        orientation = options.get("orientation", "portrait")

        if HAS_PYCUPS and self.conn:
            try:
                cups_options = {
                    "copies": str(copies),
                    "media": "A4",
                }
                if pages and pages.lower() != "all":
                    cups_options["page-ranges"] = pages

                if is_color:
                    cups_options["ColorModel"] = "Color"
                else:
                    cups_options["ColorModel"] = "K" # Black & White / Grayscale

                if is_duplex:
                    cups_options["sides"] = "two-sided-long-edge"
                else:
                    cups_options["sides"] = "one-sided"

                if orientation == "landscape":
                    cups_options["landscape"] = "true"

                title = f"SMARTPRINT-{os.path.basename(file_path)}"
                cups_job_id = self.conn.printFile(target_queue, file_path, title, cups_options)
                logging.info(f"Submitted job to pycups ID: {cups_job_id}")
                return cups_job_id
            except Exception as e:
                logging.error(f"pycups submit file failed, falling back to lp CLI: {e}")

        # Subprocess lp CLI fallback
        lp_cmd = ["lp", "-d", target_queue, "-n", str(copies)]

        if pages and pages.lower() != "all":
            lp_cmd.extend(["-P", pages])

        if is_color:
            lp_cmd.extend(["-o", "ColorModel=Color"])
        else:
            lp_cmd.extend(["-o", "ColorModel=K"])

        if is_duplex:
            lp_cmd.extend(["-o", "sides=two-sided-long-edge"])
        else:
            lp_cmd.extend(["-o", "sides=one-sided"])

        if orientation == "landscape":
            lp_cmd.extend(["-o", "landscape"])

        lp_cmd.append(file_path)

        logging.info(f"Executing LP Command: {' '.join(lp_cmd)}")
        output = subprocess.check_output(lp_cmd, text=True)
        # Output format: request id is HP_LaserJet_USB-14 (1 file(s))
        cups_job_id = None
        for token in output.split():
            if "-" in token and target_queue in token:
                try:
                    cups_job_id = int(token.split("-")[-1])
                    break
                except ValueError:
                    pass

        return cups_job_id or 1

    def wait_for_job_completion(self, cups_job_id, timeout_seconds=120, queue_name=None):
        """
        Polls CUPS queue until job completes or fails.
        Returns (success: bool, status_message: str)
        """
        target_queue = queue_name or self.default_queue
        start_time = time.time()

        while time.time() - start_time < timeout_seconds:
            # Check if job is still in active queue
            try:
                cmd = ["lpstat", "-o", target_queue]
                out = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT)
                
                job_key = f"{target_queue}-{cups_job_id}"
                if job_key not in out and str(cups_job_id) not in out:
                    # Job no longer in active queue -> completed!
                    logging.info(f"CUPS Job {cups_job_id} completed successfully.")
                    return True, "Job completed"

            except subprocess.CalledProcessError:
                # Active queue empty
                return True, "Job completed"
            except Exception as e:
                logging.warning(f"Error checking lpstat queue: {e}")

            time.sleep(2)

        return False, f"Job timed out after {timeout_seconds} seconds"


if __name__ == "__main__":
    controller = CupsController()
    status, msg = controller.get_queue_status()
    print(f"Default Queue Status: {status} ({msg})")
    printers = controller.detect_usb_printers()
    print(f"Detected USB Printers: {json.dumps(printers, indent=2)}")
