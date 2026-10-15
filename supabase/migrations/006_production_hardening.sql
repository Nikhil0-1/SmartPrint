-- ==============================================================================
-- GITAM SMARTPRINT — MIGRATION 005: PRODUCTION HARDENING
-- Idempotent patches for multi-user FIFO queue reliability.
-- Safe to re-run on existing databases.
-- ==============================================================================

-- ─── 1. ENSURE payment_orders TABLE EXISTS ───────────────────────────────────
-- This table tracks every Razorpay order so the webhook can resolve org + job.
CREATE TABLE IF NOT EXISTS payment_orders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      VARCHAR(50)      NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
    organization_id UUID         NOT NULL,
    razorpay_order_id VARCHAR(100) UNIQUE NOT NULL,
    amount_paise    INTEGER      NOT NULL,
    currency        VARCHAR(10)  DEFAULT 'INR',
    status          VARCHAR(30)  DEFAULT 'CREATED',
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_job_id
    ON payment_orders(job_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_razorpay_order_id
    ON payment_orders(razorpay_order_id);

-- ─── 2. ENSURE payment_transactions TABLE EXISTS ─────────────────────────────
CREATE TABLE IF NOT EXISTS payment_transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              VARCHAR(50)  NOT NULL,
    organization_id     UUID         NOT NULL,
    razorpay_order_id   VARCHAR(100) NOT NULL,
    razorpay_payment_id VARCHAR(100) UNIQUE NOT NULL,
    amount_paise        INTEGER      NOT NULL,
    currency            VARCHAR(10)  DEFAULT 'INR',
    status              VARCHAR(30)  DEFAULT 'SUCCESS',
    raw_payload         JSONB,
    verified_at         TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_tx_job_id
    ON payment_transactions(job_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_payment_id
    ON payment_transactions(razorpay_payment_id);

-- ─── 3. ENSURE webhook_events IDEMPOTENCY TABLE EXISTS ───────────────────────
CREATE TABLE IF NOT EXISTS webhook_events (
    id              TEXT PRIMARY KEY,
    organization_id UUID,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}',
    processed_at    TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─── 4. ENSURE system_logs TABLE EXISTS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level       TEXT NOT NULL,
    component   TEXT NOT NULL,
    kiosk_id    TEXT,
    job_id      TEXT,
    message     TEXT NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_logs_job_id   ON system_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_level     ON system_logs(level);
CREATE INDEX IF NOT EXISTS idx_system_logs_created   ON system_logs(created_at DESC);

-- ─── 5. GUARANTEE FIFO COLUMNS EXIST ON print_jobs ───────────────────────────
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS queue_sequence  BIGINT;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS queued_at       TIMESTAMP WITH TIME ZONE;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS customer_access_token VARCHAR(64);
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS worker_lease_id VARCHAR(100);
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS dispatched_at   TIMESTAMP WITH TIME ZONE;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS retry_count     INTEGER DEFAULT 0;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS max_retries     INTEGER DEFAULT 3;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS file_storage_path TEXT;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS file_url        TEXT;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS document_name   VARCHAR(255);
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS completed_at    TIMESTAMP WITH TIME ZONE;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS error_message   TEXT;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS cups_job_id     INTEGER;

-- ─── 6. CREATE SEQUENCE FOR queue_sequence IF NOT EXISTS ─────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'print_jobs_queue_seq') THEN
        CREATE SEQUENCE print_jobs_queue_seq START 1 INCREMENT 1;
    END IF;
END $$;

-- Back-fill queue_sequence for existing rows that have none
UPDATE print_jobs
SET queue_sequence = nextval('print_jobs_queue_seq')
WHERE queue_sequence IS NULL;

-- ─── 7. FIFO PERFORMANCE INDEXES ─────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_print_jobs_access_token
    ON print_jobs(customer_access_token)
    WHERE customer_access_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_print_jobs_fifo_queue
    ON print_jobs(printer_id, status, queue_sequence ASC);

CREATE INDEX IF NOT EXISTS idx_print_jobs_queued_at
    ON print_jobs(queued_at);

CREATE INDEX IF NOT EXISTS idx_print_jobs_worker_lease
    ON print_jobs(worker_lease_id, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_print_jobs_kiosk_status
    ON print_jobs(kiosk_id, status);

-- ─── 8. REPLACE claim_next_print_job WITH CANONICAL VERSION ──────────────────
-- This version correctly handles both printer-specific and kiosk-wide claiming.
-- It also resolves stale leases (DISPATCHED / ACKNOWLEDGED with expired lease).
CREATE OR REPLACE FUNCTION claim_next_print_job(
    p_kiosk_id       VARCHAR,
    p_worker_id      VARCHAR,
    p_lease_seconds  INTEGER DEFAULT 90,
    p_printer_id     UUID    DEFAULT NULL
)
RETURNS TABLE (
    id                VARCHAR(50),
    organization_id   UUID,
    kiosk_id          VARCHAR(50),
    printer_id        UUID,
    cups_queue_name   VARCHAR(100),
    status            VARCHAR(40),
    queue_sequence    BIGINT,
    queued_at         TIMESTAMP WITH TIME ZONE,
    pages_total       INTEGER,
    pages_selected    VARCHAR(100),
    copies            INTEGER,
    is_color          BOOLEAN,
    is_duplex         BOOLEAN,
    orientation       VARCHAR(20),
    paper_size        VARCHAR(10),
    calculated_amount NUMERIC(10,2),
    amount_paise      INTEGER,
    idempotency_key   VARCHAR(100),
    document_name     VARCHAR(255),
    file_storage_path TEXT,
    retry_count       INTEGER,
    worker_lease_id   VARCHAR(100),
    lease_expires_at  TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
    v_job_id VARCHAR(50);
BEGIN
    SELECT pj.id INTO v_job_id
    FROM print_jobs pj
    LEFT JOIN printers p ON pj.printer_id = p.id
    WHERE pj.kiosk_id = p_kiosk_id
      AND (p_printer_id IS NULL OR pj.printer_id = p_printer_id)
      AND (p.id IS NULL OR p.status != 'OFFLINE')
      AND (
          pj.status = 'QUEUED'
          OR (
              pj.status IN ('DISPATCHED', 'ACKNOWLEDGED')
              AND pj.lease_expires_at < CURRENT_TIMESTAMP
              AND pj.retry_count < pj.max_retries
          )
      )
    ORDER BY pj.queue_sequence ASC NULLS LAST, pj.queued_at ASC NULLS LAST
    LIMIT 1
    FOR UPDATE OF pj SKIP LOCKED;

    IF v_job_id IS NOT NULL THEN
        UPDATE print_jobs pj
        SET status          = 'DISPATCHED',
            worker_lease_id = p_worker_id,
            dispatched_at   = CURRENT_TIMESTAMP,
            lease_expires_at = CURRENT_TIMESTAMP + (p_lease_seconds || ' seconds')::INTERVAL,
            retry_count     = CASE
                                WHEN pj.status IN ('DISPATCHED', 'ACKNOWLEDGED')
                                THEN pj.retry_count + 1
                                ELSE pj.retry_count
                              END
        WHERE pj.id = v_job_id;

        RETURN QUERY
        SELECT
            pj.id,
            pj.organization_id,
            pj.kiosk_id,
            pj.printer_id,
            COALESCE(p.cups_queue_name, 'Pantum_M7108DW')::VARCHAR(100),
            pj.status,
            pj.queue_sequence,
            pj.queued_at,
            pj.pages_total,
            pj.pages_selected,
            pj.copies,
            pj.is_color,
            pj.is_duplex,
            pj.orientation,
            pj.paper_size,
            pj.calculated_amount,
            pj.amount_paise,
            pj.idempotency_key,
            pj.document_name,
            pj.file_storage_path,
            pj.retry_count,
            pj.worker_lease_id,
            pj.lease_expires_at
        FROM print_jobs pj
        LEFT JOIN printers p ON pj.printer_id = p.id
        WHERE pj.id = v_job_id;
    END IF;

    RETURN;
END;
$$ LANGUAGE plpgsql;

-- ─── 9. REPLACE get_job_queue_position ────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_job_queue_position(p_job_id VARCHAR(50))
RETURNS TABLE (
    job_id                VARCHAR(50),
    printer_id            UUID,
    printer_name          VARCHAR(100),
    queue_sequence        BIGINT,
    jobs_ahead            BIGINT,
    queue_position        BIGINT,
    status                VARCHAR(40),
    status_label          VARCHAR(100),
    estimated_wait_seconds INTEGER
) AS $$
DECLARE
    v_target_seq  BIGINT;
    v_printer_id  UUID;
    v_printer_name VARCHAR(100);
    v_status      VARCHAR(40);
    v_jobs_ahead  BIGINT := 0;
BEGIN
    SELECT pj.queue_sequence, pj.printer_id,
           COALESCE(p.display_name, p.printer_name), pj.status
    INTO v_target_seq, v_printer_id, v_printer_name, v_status
    FROM print_jobs pj
    LEFT JOIN printers p ON pj.printer_id = p.id
    WHERE pj.id = p_job_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF v_printer_id IS NOT NULL AND v_target_seq IS NOT NULL THEN
        SELECT COUNT(*) INTO v_jobs_ahead
        FROM print_jobs
        WHERE printer_id = v_printer_id
          AND status IN ('QUEUED','DISPATCHED','ACKNOWLEDGED','SUBMITTED_TO_CUPS','PRINTING')
          AND (queue_sequence < v_target_seq
               OR (queue_sequence = v_target_seq AND id != p_job_id));
    END IF;

    RETURN QUERY
    SELECT
        p_job_id,
        v_printer_id,
        COALESCE(v_printer_name, 'Assigned Printer')::VARCHAR(100),
        COALESCE(v_target_seq, 0)::BIGINT,
        v_jobs_ahead,
        (v_jobs_ahead + 1)::BIGINT,
        COALESCE(v_status, 'UNKNOWN')::VARCHAR(40),
        CASE
            WHEN v_status IN ('CREATED','PAYMENT_PENDING')    THEN 'Waiting for payment confirmation'
            WHEN v_status = 'PAYMENT_VERIFIED'                THEN 'Payment verified'
            WHEN v_status = 'QUEUED' AND v_jobs_ahead = 0     THEN 'Your document is next in queue'
            WHEN v_status = 'QUEUED'                          THEN 'Added to print queue'
            WHEN v_status IN ('DISPATCHED','ACKNOWLEDGED')    THEN 'Printer is preparing your document'
            WHEN v_status IN ('SUBMITTED_TO_CUPS','PRINTING') THEN 'Printing started'
            WHEN v_status = 'COMPLETED'                       THEN 'Printing completed'
            WHEN v_status = 'PRINTER_OFFLINE'                 THEN 'Printer temporarily offline'
            WHEN v_status IN ('FAILED','RECOVERY_REQUIRED')   THEN 'Print failed — assistance required'
            WHEN v_status = 'CANCELLED'                       THEN 'Job cancelled'
            ELSE COALESCE(v_status, 'Unknown')
        END::VARCHAR(100),
        (v_jobs_ahead * 20)::INTEGER;
END;
$$ LANGUAGE plpgsql;

-- ─── 10. dbEnqueuePrintJob: AUTO-ASSIGN queue_sequence ───────────────────────
-- Trigger to assign queue_sequence automatically when a job transitions to QUEUED.
CREATE OR REPLACE FUNCTION assign_queue_sequence()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'QUEUED' AND (OLD.status IS NULL OR OLD.status != 'QUEUED') THEN
        IF NEW.queue_sequence IS NULL THEN
            NEW.queue_sequence := nextval('print_jobs_queue_seq');
        END IF;
        IF NEW.queued_at IS NULL THEN
            NEW.queued_at := CURRENT_TIMESTAMP;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_queue_sequence ON print_jobs;
CREATE TRIGGER trg_assign_queue_sequence
BEFORE UPDATE ON print_jobs
FOR EACH ROW
EXECUTE FUNCTION assign_queue_sequence();

-- ─── 11. RLS POLICIES ─────────────────────────────────────────────────────────
-- Ensure service_role bypasses RLS for all server-side operations.
-- (Supabase enables RLS on user tables by default; service_role is exempt.)
ALTER TABLE IF EXISTS print_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payment_orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS webhook_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS system_logs      ENABLE ROW LEVEL SECURITY;

-- Service role always bypasses RLS — these policies are for anon/authenticated:
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'print_jobs' AND policyname = 'service_role_all'
    ) THEN
        CREATE POLICY service_role_all ON print_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- ─── 12. GRANT EXECUTE ON RPC FUNCTIONS ──────────────────────────────────────
GRANT EXECUTE ON FUNCTION claim_next_print_job(VARCHAR, VARCHAR, INTEGER, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION get_job_queue_position(VARCHAR) TO service_role;
