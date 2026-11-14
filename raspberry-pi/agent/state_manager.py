#!/usr/bin/env python3
"""
GITAM SMARTPRINT - Durable State Manager & SQLite State Machine
Provides atomic transactions, idempotency guards, lifecycle history,
crash recovery tracking, and durable cloud-reporting outbox.
"""

import os
import sys
import time
import json
import random
import sqlite3
import logging
import tempfile
from typing import Optional, Dict, Any, List, Tuple

logger = logging.getLogger("smartprint.state_manager")

# Standard paths (cross-platform safe fallback for development/testing)
if sys.platform == "win32":
    DEFAULT_STATE_DIR = os.getenv("SMARTPRINT_STATE_DIR", os.path.join(tempfile.gettempdir(), "smartprint"))
else:
    DEFAULT_STATE_DIR = os.getenv("SMARTPRINT_STATE_DIR", "/var/lib/smartprint")

DEFAULT_STATE_DB = os.path.join(DEFAULT_STATE_DIR, "agent_state.db")
DEFAULT_LOCK_FILE = os.path.join(DEFAULT_STATE_DIR, "agent.lock")

# Canonical Lifecycle States
STATE_RECEIVED = "RECEIVED"
STATE_RESERVED = "RESERVED"
STATE_ACKNOWLEDGED = "ACKNOWLEDGED"
STATE_DOWNLOADING = "DOWNLOADING"
STATE_PROCESSING = "PROCESSING"
STATE_SUBMITTING_TO_CUPS = "SUBMITTING_TO_CUPS"
STATE_SUBMITTED_TO_CUPS = "SUBMITTED_TO_CUPS"
STATE_PRINTING = "PRINTING"
STATE_COMPLETED = "COMPLETED"
STATE_CLOUD_COMPLETED = "CLOUD_COMPLETED"

# Failure and Recovery States
STATE_FAILED_BEFORE_SUBMISSION = "FAILED_BEFORE_SUBMISSION"
STATE_ACK_RETRY_PENDING = "ACK_RETRY_PENDING"
STATE_CLOUD_COMPLETION_PENDING = "CLOUD_COMPLETION_PENDING"
STATE_OUTCOME_UNCERTAIN = "OUTCOME_UNCERTAIN"
STATE_RECOVERY_REQUIRED = "RECOVERY_REQUIRED"
STATE_CUPS_SUBMISSION_UNCERTAIN = "CUPS_SUBMISSION_UNCERTAIN"

# States indicating the job was already accepted or entered the print path
# Jobs in these states must NEVER be blindly re-submitted to CUPS.
NON_RETRYABLE_PRINT_STATES = {
    STATE_RESERVED,
    STATE_ACKNOWLEDGED,
    STATE_DOWNLOADING,
    STATE_PROCESSING,
    STATE_SUBMITTING_TO_CUPS,
    STATE_SUBMITTED_TO_CUPS,
    STATE_PRINTING,
    STATE_COMPLETED,
    STATE_CLOUD_COMPLETED,
    STATE_CLOUD_COMPLETION_PENDING,
    STATE_OUTCOME_UNCERTAIN,
    STATE_RECOVERY_REQUIRED,
    STATE_CUPS_SUBMISSION_UNCERTAIN,
}

# Finalized terminal states that need no further active lifecycle handling
TERMINAL_STATES = {
    STATE_CLOUD_COMPLETED,
    STATE_FAILED_BEFORE_SUBMISSION,
}


class StateManager:
    """Manages SQLite-backed local state with strict ACID guarantees."""

    def __init__(self, db_path: Optional[str] = None, state_dir: Optional[str] = None):
        self.state_dir = state_dir or os.getenv("SMARTPRINT_STATE_DIR", DEFAULT_STATE_DIR)
        self.db_path = db_path or os.getenv("SMARTPRINT_STATE_DB", os.path.join(self.state_dir, "agent_state.db"))
        self.lock_file_path = os.getenv("SMARTPRINT_LOCK_FILE", os.path.join(self.state_dir, "agent.lock"))
        self._lock_fd = None
        self._init_storage()
        self._run_migrations()

    def _get_connection(self) -> sqlite3.Connection:
        """Opens a connection with WAL mode and foreign keys enabled."""
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA busy_timeout = 30000;")
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    def _init_storage(self) -> None:
        """Ensures state directory and database file permissions are strict (0700/0600)."""
        try:
            os.makedirs(self.state_dir, mode=0o700, exist_ok=True)
            if hasattr(os, "chmod"):
                try:
                    os.chmod(self.state_dir, 0o700)
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"Could not enforce 0700 on {self.state_dir}: {e}")

    def _run_migrations(self) -> None:
        """Initializes tables and migrates any legacy schemas without data loss."""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            # 1. Main job_state table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS job_state (
                    job_id TEXT PRIMARY KEY,
                    idempotency_key TEXT UNIQUE,
                    kiosk_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    cups_job_id INTEGER,
                    cups_queue TEXT,
                    document_path TEXT,
                    pages_total INTEGER DEFAULT 1,
                    pages_selected TEXT DEFAULT 'All',
                    copies INTEGER DEFAULT 1,
                    is_color INTEGER DEFAULT 0,
                    is_duplex INTEGER DEFAULT 0,
                    error_message TEXT,
                    recovery_reason TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    acknowledged_at TIMESTAMP,
                    submitted_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    cloud_completed_at TIMESTAMP
                );
            """)

            # 2. State history audit table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS job_state_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    from_status TEXT,
                    to_status TEXT NOT NULL,
                    details TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (job_id) REFERENCES job_state(job_id) ON DELETE CASCADE
                );
            """)

            # 3. Durable cloud outbox table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS cloud_outbox (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    endpoint TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'PENDING',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    max_attempts INTEGER NOT NULL DEFAULT 50,
                    next_retry_at REAL NOT NULL,
                    last_error TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            # 4. Indices for efficient querying
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_job_state_status ON job_state(status);")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_job_state_idempotency ON job_state(idempotency_key);")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_cloud_outbox_pending ON cloud_outbox(status, next_retry_at);")

            # 5. Legacy migration: migrate from older 'processed_jobs' table if it exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='processed_jobs';")
            if cursor.fetchone():
                logger.info("Migrating legacy 'processed_jobs' table into 'job_state'...")
                cursor.execute("""
                    INSERT OR IGNORE INTO job_state (job_id, idempotency_key, kiosk_id, status, cups_job_id, created_at)
                    SELECT job_id, idempotency_key, 'LEGACY', status, cups_job_id, processed_at
                    FROM processed_jobs;
                """)

            conn.commit()

        # Enforce 0600 on DB file
        try:
            if os.path.exists(self.db_path) and hasattr(os, "chmod"):
                os.chmod(self.db_path, 0o600)
        except Exception:
            pass

    # --------------------------------------------------------------------------
    # Single-Instance Process Locking
    # --------------------------------------------------------------------------
    def acquire_process_lock(self) -> bool:
        """Acquires an exclusive file lock to ensure only one agent daemon runs."""
        try:
            lock_dir = os.path.dirname(self.lock_file_path)
            if lock_dir:
                os.makedirs(lock_dir, mode=0o700, exist_ok=True)
            self._lock_fd = open(self.lock_file_path, "a+")

            # On Unix systems, use fcntl
            if hasattr(os, "O_NONBLOCK"):
                try:
                    import fcntl
                    fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except (ImportError, OSError):
                    pass

            self._lock_fd.seek(0)
            self._lock_fd.truncate()
            self._lock_fd.write(f"{os.getpid()}\n")
            self._lock_fd.flush()
            return True
        except Exception as e:
            logger.error(f"Failed to acquire single-instance lock on {self.lock_file_path}: {e}")
            return False

    def release_process_lock(self) -> None:
        """Releases the process lock file."""
        if self._lock_fd:
            try:
                try:
                    import fcntl
                    fcntl.flock(self._lock_fd, fcntl.LOCK_UN)
                except (ImportError, OSError):
                    pass
                self._lock_fd.close()
            except Exception:
                pass
            self._lock_fd = None
        try:
            if os.path.exists(self.lock_file_path):
                os.remove(self.lock_file_path)
        except Exception:
            pass

    # --------------------------------------------------------------------------
    # Atomic Job Reservation & Idempotency
    # --------------------------------------------------------------------------
    def reserve_job(
        self,
        job_id: str,
        idempotency_key: Optional[str],
        kiosk_id: str,
        pages_total: int = 1,
        pages_selected: str = "All",
        copies: int = 1,
        is_color: bool = False,
        is_duplex: bool = False,
    ) -> Tuple[bool, Optional[str]]:
        """
        Atomically reserves a job in SQLite before any irreversible action.
        Returns:
            (True, None) if successfully reserved.
            (False, existing_status) if the job already exists in SQLite.
        """
        with self._get_connection() as conn:
            cursor = conn.cursor()

            # Check if job already exists by job_id or idempotency_key
            query = "SELECT status FROM job_state WHERE job_id = ?"
            params = [job_id]
            if idempotency_key:
                query += " OR (idempotency_key IS NOT NULL AND idempotency_key = ?)"
                params.append(idempotency_key)

            cursor.execute(query, tuple(params))
            row = cursor.fetchone()
            if row:
                existing_status = row["status"]
                logger.warning(
                    f"Job {job_id} already exists in local DB with status '{existing_status}'. "
                    f"Refusing duplicate reservation."
                )
                return False, existing_status

            # Insert atomic reservation record
            try:
                cursor.execute(
                    """
                    INSERT INTO job_state (
                        job_id, idempotency_key, kiosk_id, status,
                        pages_total, pages_selected, copies, is_color, is_duplex,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """,
                    (
                        job_id,
                        idempotency_key,
                        kiosk_id,
                        STATE_RESERVED,
                        pages_total,
                        pages_selected,
                        copies,
                        1 if is_color else 0,
                        1 if is_duplex else 0,
                    ),
                )
                cursor.execute(
                    """
                    INSERT INTO job_state_history (job_id, from_status, to_status, details)
                    VALUES (?, NULL, ?, ?)
                    """,
                    (job_id, STATE_RESERVED, "Initial atomic job reservation"),
                )
                conn.commit()
                logger.info(f"DURABLE RESERVATION: Job {job_id} safely reserved in local SQLite.")
                return True, None
            except sqlite3.IntegrityError as e:
                # Race condition guard
                cursor.execute("SELECT status FROM job_state WHERE job_id = ?", (job_id,))
                existing = cursor.fetchone()
                return False, existing["status"] if existing else "UNKNOWN"

    def transition_status(
        self,
        job_id: str,
        to_status: str,
        cups_job_id: Optional[int] = None,
        cups_queue: Optional[str] = None,
        document_path: Optional[str] = None,
        error_message: Optional[str] = None,
        recovery_reason: Optional[str] = None,
        details: Optional[str] = None,
    ) -> bool:
        """
        Transitions job state atomically, updating timestamps and history log.
        """
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT status, cups_job_id FROM job_state WHERE job_id = ?", (job_id,))
            current = cursor.fetchone()
            if not current:
                logger.error(f"Cannot transition status for non-existent job {job_id}")
                return False

            from_status = current["status"]
            retained_cups_id = cups_job_id or current["cups_job_id"]

            extra_updates = []
            params = [to_status]

            if retained_cups_id is not None:
                extra_updates.append("cups_job_id = ?")
                params.append(retained_cups_id)
            if cups_queue is not None:
                extra_updates.append("cups_queue = ?")
                params.append(cups_queue)
            if document_path is not None:
                extra_updates.append("document_path = ?")
                params.append(document_path)
            if error_message is not None:
                extra_updates.append("error_message = ?")
                params.append(error_message)
            if recovery_reason is not None:
                extra_updates.append("recovery_reason = ?")
                params.append(recovery_reason)

            # Specific timestamp updates
            if to_status == STATE_ACKNOWLEDGED:
                extra_updates.append("acknowledged_at = CURRENT_TIMESTAMP")
            elif to_status in (STATE_SUBMITTED_TO_CUPS, STATE_PRINTING):
                extra_updates.append("submitted_at = CURRENT_TIMESTAMP")
            elif to_status == STATE_COMPLETED:
                extra_updates.append("completed_at = CURRENT_TIMESTAMP")
            elif to_status == STATE_CLOUD_COMPLETED:
                extra_updates.append("cloud_completed_at = CURRENT_TIMESTAMP")

            extra_clause = ", " + ", ".join(extra_updates) if extra_updates else ""
            params.extend([job_id])

            cursor.execute(
                f"""
                UPDATE job_state
                SET status = ?, updated_at = CURRENT_TIMESTAMP {extra_clause}
                WHERE job_id = ?
                """,
                tuple(params),
            )

            # Record in history
            hist_details = details or error_message or recovery_reason or f"CUPS Job ID: {retained_cups_id}"
            cursor.execute(
                """
                INSERT INTO job_state_history (job_id, from_status, to_status, details)
                VALUES (?, ?, ?, ?)
                """,
                (job_id, from_status, to_status, hist_details),
            )
            conn.commit()
            logger.info(f"STATE CHANGE: [{job_id}] {from_status} -> {to_status}")
            return True

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Fetches full job record by job_id."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM job_state WHERE job_id = ?", (job_id,))
            row = cursor.fetchone()
            if not row:
                return None
            res = dict(row)
            if "status" in res and "current_state" not in res:
                res["current_state"] = res["status"]
            return res

    def get_job_state(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Alias for get_job returning state record with current_state."""
        return self.get_job(job_id)

    def record_state_history(
        self,
        job_id: str,
        from_state: Optional[str],
        to_state: str,
        details: Optional[str] = None
    ) -> None:
        """Explicitly records an event, status transition, or failover in job state history."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO job_state_history (job_id, from_status, to_status, details)
                VALUES (?, ?, ?, ?)
                """,
                (job_id, from_state or "NONE", to_state, details or ""),
            )
            conn.commit()

    def get_job_history(self, job_id: str) -> List[Dict[str, Any]]:
        """Returns ordered history records for a specific job."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM job_state_history WHERE job_id = ? ORDER BY id ASC",
                (job_id,)
            )
            rows = cursor.fetchall()
            return [dict(r) for r in rows]

    def get_job_by_idempotency_key(self, idempotency_key: str) -> Optional[Dict[str, Any]]:
        """Fetches job record by idempotency_key."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM job_state WHERE idempotency_key = ?", (idempotency_key,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def is_job_known(self, job_id: str, idempotency_key: Optional[str] = None) -> bool:
        """Returns True if the job is already tracked locally."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            if idempotency_key:
                cursor.execute(
                    "SELECT 1 FROM job_state WHERE job_id = ? OR idempotency_key = ? LIMIT 1",
                    (job_id, idempotency_key),
                )
            else:
                cursor.execute("SELECT 1 FROM job_state WHERE job_id = ? LIMIT 1", (job_id,))
            return cursor.fetchone() is not None

    def get_unresolved_recovery_jobs(self) -> List[Dict[str, Any]]:
        """Returns jobs marked OUTCOME_UNCERTAIN, RECOVERY_REQUIRED, or CUPS_SUBMISSION_UNCERTAIN."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM job_state
                WHERE status IN (?, ?, ?)
                ORDER BY created_at DESC
                """,
                (STATE_OUTCOME_UNCERTAIN, STATE_RECOVERY_REQUIRED, STATE_CUPS_SUBMISSION_UNCERTAIN),
            )
            return [dict(r) for r in cursor.fetchall()]

    def get_in_flight_jobs(self) -> List[Dict[str, Any]]:
        """Returns jobs that were mid-execution before a crash or restart."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM job_state
                WHERE status IN (?, ?, ?, ?, ?)
                ORDER BY created_at ASC
                """,
                (
                    STATE_RESERVED,
                    STATE_ACKNOWLEDGED,
                    STATE_DOWNLOADING,
                    STATE_PROCESSING,
                    STATE_SUBMITTING_TO_CUPS,
                ),
            )
            return [dict(r) for r in cursor.fetchall()]

    def get_submitted_active_jobs(self) -> List[Dict[str, Any]]:
        """Returns jobs where CUPS submission was initiated or completed locally."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM job_state
                WHERE status IN (?, ?, ?, ?)
                ORDER BY created_at ASC
                """,
                (
                    STATE_SUBMITTED_TO_CUPS,
                    STATE_PRINTING,
                    STATE_COMPLETED,
                    STATE_CLOUD_COMPLETION_PENDING,
                ),
            )
            return [dict(r) for r in cursor.fetchall()]

    # --------------------------------------------------------------------------
    # Cloud Outbox Queue (Durable Retry Machine)
    # --------------------------------------------------------------------------
    def enqueue_outbox(
        self,
        job_id: str,
        endpoint: str,
        payload: Dict[str, Any],
        max_attempts: int = 50,
        delay_seconds: float = 0.0,
    ) -> int:
        """Enqueues a cloud report to durable outbox for guaranteed delivery."""
        now = time.time()
        next_retry = now + delay_seconds
        payload_json = json.dumps(payload)

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO cloud_outbox (job_id, endpoint, payload_json, status, attempts, max_attempts, next_retry_at)
                VALUES (?, ?, ?, 'PENDING', 0, ?, ?)
                """,
                (job_id, endpoint, payload_json, max_attempts, next_retry),
            )
            outbox_id = cursor.lastrowid
            conn.commit()
            logger.info(f"OUTBOX ENQUEUED: id={outbox_id} job={job_id} endpoint={endpoint}")
            return outbox_id

    def get_pending_outbox_items(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Fetches pending outbox items that are ready for delivery."""
        now = time.time()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, job_id, endpoint, payload_json, attempts, max_attempts
                FROM cloud_outbox
                WHERE status = 'PENDING' AND next_retry_at <= ?
                ORDER BY next_retry_at ASC
                LIMIT ?
                """,
                (now, limit),
            )
            rows = cursor.fetchall()
            items = []
            for r in rows:
                items.append({
                    "id": r["id"],
                    "job_id": r["job_id"],
                    "endpoint": r["endpoint"],
                    "payload": json.loads(r["payload_json"]),
                    "attempts": r["attempts"],
                    "max_attempts": r["max_attempts"],
                })
            return items

    def mark_outbox_success(self, outbox_id: int) -> None:
        """Marks an outbox item as successfully delivered."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE cloud_outbox
                SET status = 'SUCCESS', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (outbox_id,),
            )
            conn.commit()

    def mark_outbox_failure(self, outbox_id: int, error_message: str, base_backoff: float = 2.0) -> None:
        """
        Increments attempt count and applies exponential backoff with jitter.
        """
        now = time.time()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT attempts, max_attempts FROM cloud_outbox WHERE id = ?", (outbox_id,))
            row = cursor.fetchone()
            if not row:
                return

            attempts = row["attempts"] + 1
            max_attempts = row["max_attempts"]

            if attempts >= max_attempts:
                new_status = "FAILED"
                next_retry = now + 86400.0  # pause 24h
                logger.error(f"OUTBOX PERMANENT FAILURE: id={outbox_id} after {attempts} attempts: {error_message}")
            else:
                new_status = "PENDING"
                # Exponential backoff capped at 300s + jitter
                delay = min(300.0, (base_backoff ** min(attempts, 8))) + random.uniform(0.5, 3.0)
                next_retry = now + delay
                logger.warning(
                    f"OUTBOX RETRY SCHEDULED: id={outbox_id} attempt={attempts}/{max_attempts} "
                    f"retry_in={delay:.1f}s err={error_message}"
                )

            cursor.execute(
                """
                UPDATE cloud_outbox
                SET attempts = ?, status = ?, next_retry_at = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (attempts, new_status, next_retry, str(error_message)[:500], outbox_id),
            )
            conn.commit()

    def get_outbox_summary(self) -> Dict[str, int]:
        """Returns count of pending, success, and failed outbox items."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT
                    SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success,
                    SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed
                FROM cloud_outbox;
            """)
            row = cursor.fetchone()
            return {
                "pending": row["pending"] or 0,
                "success": row["success"] or 0,
                "failed": row["failed"] or 0,
            }
