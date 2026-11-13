#!/usr/bin/env python3
"""
GITAM SMARTPRINT - Document Privacy & Bounded Retention Manager
Handles secure local workspace creation, best-effort flash data destruction,
recovery file preservation, and 24-hour bounded retention policy.
"""

import os
import sys
import time
import json
import re
import shutil
import logging
import tempfile
from typing import Optional, Dict, Any, List, Tuple

logger = logging.getLogger("smartprint.document_manager")

if sys.platform == "win32":
    DEFAULT_STATE_DIR = os.getenv("SMARTPRINT_STATE_DIR", os.path.join(tempfile.gettempdir(), "smartprint"))
else:
    DEFAULT_STATE_DIR = os.getenv("SMARTPRINT_STATE_DIR", "/var/lib/smartprint")

JOBS_DIR = os.path.join(DEFAULT_STATE_DIR, "jobs")
RECOVERY_DIR = os.path.join(DEFAULT_STATE_DIR, "recovery")

# Strict identifier regex to prevent directory traversal
SAFE_ID_REGEX = re.compile(r"^[a-zA-Z0-9_\-]+$")


def sanitize_job_id(job_id: str) -> str:
    """Ensures job_id contains only alphanumeric characters, underscores, and hyphens."""
    if not job_id or not SAFE_ID_REGEX.match(job_id):
        raise ValueError(f"Invalid or unsafe job_id format: {job_id!r}")
    return job_id


def secure_wipe_file(file_path: str) -> None:
    """
    Overwrites document file with zeros before unlinking.

    NOTE ON FLASH STORAGE / SD CARDS:
    Solid-state and flash memory (SD cards, eMMC, SSDs) employ internal Wear Leveling
    and Flash Translation Layers (FTL). Traditional in-place block overwrites cannot
    guarantee that previous physical NAND erase blocks are destroyed.
    This function performs best-effort data overwriting and cache flushing, followed
    by immediate unlinking to protect customer document privacy.
    Full physical destruction on flash media requires filesystem-level encryption
    with discarded ephemeral keys.
    """
    if not os.path.exists(file_path):
        return

    try:
        size = os.path.getsize(file_path)
        if size > 0:
            # Overwrite with zeros
            with open(file_path, "wb") as f:
                chunk_size = 65536
                zeros = b"\x00" * chunk_size
                written = 0
                while written < size:
                    to_write = min(chunk_size, size - written)
                    f.write(zeros[:to_write])
                    written += to_write
                f.flush()
                try:
                    os.fsync(f.fileno())
                except Exception:
                    pass

        # Optional invocation of shred tool if present
        shred_path = shutil.which("shred")
        if shred_path:
            try:
                import subprocess
                subprocess.run(
                    [shred_path, "-u", "-n", "1", file_path],
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=5,
                )
            except Exception:
                pass

        if os.path.exists(file_path):
            os.remove(file_path)

        logger.info(f"SECURE WIPE: Document unlinked and zero-flushed: {os.path.basename(file_path)}")
    except Exception as e:
        logger.error(f"Error during secure wipe of {file_path}: {e}")
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception:
            pass


class DocumentManager:
    """Manages temporary job workspaces and bounded recovery retention."""

    def __init__(self, state_dir: Optional[str] = None):
        self.state_dir = state_dir or DEFAULT_STATE_DIR
        self.jobs_dir = os.path.join(self.state_dir, "jobs")
        self.recovery_dir = os.path.join(self.state_dir, "recovery")
        self._init_directories()

    def _init_directories(self) -> None:
        """Creates restricted 0700 directories for active and recovery jobs."""
        for d in (self.jobs_dir, self.recovery_dir):
            try:
                os.makedirs(d, mode=0o700, exist_ok=True)
                if hasattr(os, "chmod"):
                    os.chmod(d, 0o700)
            except Exception as e:
                logger.warning(f"Could not enforce 0700 on {d}: {e}")

    def prepare_job_workspace(self, job_id: str) -> str:
        """
        Creates an isolated, restricted directory (0700) for a job's temporary PDF.
        Returns the absolute path to the local document file.
        """
        clean_id = sanitize_job_id(job_id)
        job_dir = os.path.join(self.jobs_dir, clean_id)
        os.makedirs(job_dir, mode=0o700, exist_ok=True)
        try:
            if hasattr(os, "chmod"):
                os.chmod(job_dir, 0o700)
        except Exception:
            pass

        return os.path.join(job_dir, "document.pdf")

    def cleanup_job_workspace(self, job_id: str) -> None:
        """
        Destroys temporary files for a completed or aborted job.
        Wipes file with zeros and removes the directory.
        """
        try:
            clean_id = sanitize_job_id(job_id)
            job_dir = os.path.join(self.jobs_dir, clean_id)
            if not os.path.exists(job_dir):
                return

            for fname in os.listdir(job_dir):
                fpath = os.path.join(job_dir, fname)
                if os.path.isfile(fpath):
                    secure_wipe_file(fpath)

            try:
                os.rmdir(job_dir)
            except Exception:
                shutil.rmtree(job_dir, ignore_errors=True)

            logger.info(f"CLEANUP COMPLETE: Workspace destroyed for job {clean_id}")
        except Exception as e:
            logger.error(f"Error cleaning workspace for job {job_id}: {e}")

    def preserve_for_recovery(
        self,
        job_id: str,
        current_file_path: str,
        metadata: Dict[str, Any],
    ) -> Optional[str]:
        """
        Preserves document in the restricted recovery folder instead of deleting it.
        Allows administrator/operator review without automatic reprint.
        Returns the new recovery file path.
        """
        try:
            clean_id = sanitize_job_id(job_id)
            rec_dir = os.path.join(self.recovery_dir, clean_id)
            os.makedirs(rec_dir, mode=0o700, exist_ok=True)
            if hasattr(os, "chmod"):
                os.chmod(rec_dir, 0o700)

            rec_file_path = os.path.join(rec_dir, "document.pdf")
            if os.path.exists(current_file_path):
                shutil.copy2(current_file_path, rec_file_path)
                if hasattr(os, "chmod"):
                    os.chmod(rec_file_path, 0o600)
                # Wipe the active copy now that it's moved to recovery
                secure_wipe_file(current_file_path)

            # Write recovery metadata
            meta_path = os.path.join(rec_dir, "metadata.json")
            meta_content = {
                "job_id": clean_id,
                "preserved_at": time.time(),
                "preserved_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                **metadata,
            }
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(meta_content, f, indent=2)
            if hasattr(os, "chmod"):
                os.chmod(meta_path, 0o600)

            logger.warning(
                f"RECOVERY PRESERVATION: Document for job {clean_id} moved to {rec_dir} "
                f"for administrator inspection. Automatic re-printing DISABLED."
            )
            return rec_file_path
        except Exception as e:
            logger.error(f"Failed to preserve recovery file for job {job_id}: {e}")
            return None

    def cleanup_expired_recovery_files(self, max_age_hours: int = 24) -> int:
        """
        Applies bounded recovery retention: removes recovery files older than max_age_hours.
        Returns count of purged recovery jobs.
        """
        if not os.path.exists(self.recovery_dir):
            return 0

        now = time.time()
        max_age_sec = max_age_hours * 3600
        purged = 0

        for entry in os.listdir(self.recovery_dir):
            entry_dir = os.path.join(self.recovery_dir, entry)
            if not os.path.isdir(entry_dir):
                continue

            meta_file = os.path.join(entry_dir, "metadata.json")
            doc_file = os.path.join(entry_dir, "document.pdf")

            is_expired = False
            if os.path.exists(meta_file):
                try:
                    with open(meta_file, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                        preserved_at = meta.get("preserved_at", 0)
                        if (now - preserved_at) > max_age_sec:
                            is_expired = True
                except Exception:
                    pass

            # Fallback to directory mtime
            if not is_expired:
                try:
                    mtime = os.path.getmtime(entry_dir)
                    if (now - mtime) > max_age_sec:
                        is_expired = True
                except Exception:
                    pass

            if is_expired:
                logger.info(f"EXPIRY CLEANUP: Purging expired recovery job {entry} (> {max_age_hours}h old)")
                if os.path.exists(doc_file):
                    secure_wipe_file(doc_file)
                if os.path.exists(meta_file):
                    try:
                        os.remove(meta_file)
                    except Exception:
                        pass
                try:
                    shutil.rmtree(entry_dir, ignore_errors=True)
                    purged += 1
                except Exception:
                    pass

        return purged

    def cleanup_stale_active_workspaces(self, max_age_minutes: int = 60) -> int:
        """
        Cleans up stale temporary job directories in /jobs older than max_age_minutes
        (e.g., from aborted jobs before CUPS submission).
        DOES NOT touch the recovery directory!
        """
        if not os.path.exists(self.jobs_dir):
            return 0

        now = time.time()
        max_age_sec = max_age_minutes * 60
        cleaned = 0

        for entry in os.listdir(self.jobs_dir):
            job_dir = os.path.join(self.jobs_dir, entry)
            if not os.path.isdir(job_dir):
                continue

            try:
                mtime = os.path.getmtime(job_dir)
                if (now - mtime) > max_age_sec:
                    for f in os.listdir(job_dir):
                        fp = os.path.join(job_dir, f)
                        if os.path.isfile(fp):
                            secure_wipe_file(fp)
                    shutil.rmtree(job_dir, ignore_errors=True)
                    cleaned += 1
            except Exception as e:
                logger.warning(f"Error cleaning stale job directory {job_dir}: {e}")

        return cleaned
