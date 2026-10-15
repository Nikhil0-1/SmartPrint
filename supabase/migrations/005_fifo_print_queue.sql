-- ==============================================================================
-- GITAM SMARTPRINT - PRODUCTION FIFO PRINT QUEUE & WORKER LEASE MIGRATION (004)
-- Enforces deterministic FIFO queue ordering, atomic claiming, worker leases,
-- crash recovery, queue position calculations, and hardware compatibility.
-- ==============================================================================

-- 1. ADD FIFO QUEUE & LEASE COLUMNS TO PRINT_JOBS TABLE
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS queue_sequence BIGSERIAL;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS queued_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS customer_access_token VARCHAR(64);
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS worker_lease_id VARCHAR(100);
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS max_retries INTEGER DEFAULT 3;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS file_storage_path TEXT;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS document_name VARCHAR(255);

-- Create unique index on customer_access_token for fast, unguessable status lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_print_jobs_access_token ON print_jobs(customer_access_token) WHERE customer_access_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_print_jobs_fifo_queue ON print_jobs(printer_id, status, queue_sequence ASC);
CREATE INDEX IF NOT EXISTS idx_print_jobs_queued_at ON print_jobs(queued_at);
CREATE INDEX IF NOT EXISTS idx_print_jobs_worker_lease ON print_jobs(worker_lease_id, lease_expires_at);

-- 2. SEED PANTUM M7108DW PRINTER FOR RASPBERRY PI 4 (CAMPUS KIOSK)
INSERT INTO printers (
    id,
    organization_id,
    kiosk_id,
    printer_name,
    display_name,
    manufacturer,
    model,
    cups_queue_name,
    connection_type,
    status,
    is_default,
    supports_color,
    supports_duplex,
    printer_type,
    enabled,
    priority
)
SELECT 
    '44444444-4444-4444-4444-444444444444'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'GITAM-SPK-001',
    'Pantum M7108DW',
    'Pantum Multi-Function Printer (M7108DW)',
    'Pantum',
    'Pantum M7100 Series (USB)',
    'Pantum_M7108DW',
    'USB',
    'OFFLINE', -- Default to OFFLINE until Raspberry Pi confirms physical USB/CUPS detection
    TRUE,
    FALSE,
    TRUE,
    'BW',
    TRUE,
    1
WHERE NOT EXISTS (SELECT 1 FROM printers WHERE id = '44444444-4444-4444-4444-444444444444'::uuid);

-- 3. FUNCTION TO ATOMICALLY CLAIM NEXT FIFO JOB FOR A PRINTER
-- Safe against race conditions using SELECT FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION claim_next_print_job(
    p_kiosk_id VARCHAR,
    p_worker_id VARCHAR,
    p_lease_seconds INTEGER DEFAULT 60,
    p_printer_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id VARCHAR(50),
    organization_id UUID,
    kiosk_id VARCHAR(50),
    printer_id UUID,
    cups_queue_name VARCHAR(100),
    status VARCHAR(40),
    queue_sequence BIGINT,
    pages_total INTEGER,
    pages_selected VARCHAR(100),
    copies INTEGER,
    is_color BOOLEAN,
    is_duplex BOOLEAN,
    orientation VARCHAR(20),
    paper_size VARCHAR(10),
    calculated_amount NUMERIC(10, 2),
    idempotency_key VARCHAR(100),
    document_name VARCHAR(255),
    file_storage_path TEXT,
    retry_count INTEGER,
    worker_lease_id VARCHAR(100),
    lease_expires_at TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
    v_job_id VARCHAR(50);
BEGIN
    -- Atomically select and lock the oldest eligible job for the printer or kiosk
    SELECT pj.id INTO v_job_id
    FROM print_jobs pj
    JOIN printers p ON pj.printer_id = p.id
    WHERE pj.kiosk_id = p_kiosk_id
      AND (p_printer_id IS NULL OR pj.printer_id = p_printer_id)
      AND p.status != 'OFFLINE'
      AND (
          pj.status = 'QUEUED'
          OR (
              pj.status IN ('DISPATCHED', 'ACKNOWLEDGED') 
              AND pj.lease_expires_at < CURRENT_TIMESTAMP
              AND pj.retry_count < pj.max_retries
          )
      )
    ORDER BY pj.queue_sequence ASC, pj.queued_at ASC
    LIMIT 1
    FOR UPDATE OF pj SKIP LOCKED;

    IF v_job_id IS NOT NULL THEN
        -- Update job status to DISPATCHED with worker lease and increment retry if recovering
        UPDATE print_jobs pj
        SET status = 'DISPATCHED',
            worker_lease_id = p_worker_id,
            dispatched_at = CURRENT_TIMESTAMP,
            lease_expires_at = CURRENT_TIMESTAMP + (p_lease_seconds || ' seconds')::INTERVAL,
            retry_count = CASE WHEN pj.status IN ('DISPATCHED', 'ACKNOWLEDGED') THEN pj.retry_count + 1 ELSE pj.retry_count END
        WHERE pj.id = v_job_id;

        RETURN QUERY
        SELECT 
            pj.id,
            pj.organization_id,
            pj.kiosk_id,
            pj.printer_id,
            p.cups_queue_name,
            pj.status,
            pj.queue_sequence,
            pj.pages_total,
            pj.pages_selected,
            pj.copies,
            pj.is_color,
            pj.is_duplex,
            pj.orientation,
            pj.paper_size,
            pj.calculated_amount,
            pj.idempotency_key,
            pj.document_name,
            pj.file_storage_path,
            pj.retry_count,
            pj.worker_lease_id,
            pj.lease_expires_at
        FROM print_jobs pj
        JOIN printers p ON pj.printer_id = p.id
        WHERE pj.id = v_job_id;
    END IF;

    RETURN;
END;
$$ LANGUAGE plpgsql;

-- 4. FUNCTION TO CALCULATE QUEUE POSITION DETERMINISTICALLY
CREATE OR REPLACE FUNCTION get_job_queue_position(
    p_job_id VARCHAR(50)
)
RETURNS TABLE (
    job_id VARCHAR(50),
    printer_id UUID,
    printer_name VARCHAR(100),
    queue_sequence BIGINT,
    jobs_ahead BIGINT,
    queue_position BIGINT,
    status VARCHAR(40),
    status_label VARCHAR(100),
    estimated_wait_seconds INTEGER
) AS $$
DECLARE
    v_target_seq BIGINT;
    v_printer_id UUID;
    v_printer_name VARCHAR(100);
    v_status VARCHAR(40);
    v_jobs_ahead BIGINT := 0;
BEGIN
    SELECT pj.queue_sequence, pj.printer_id, p.display_name, pj.status
    INTO v_target_seq, v_printer_id, v_printer_name, v_status
    FROM print_jobs pj
    LEFT JOIN printers p ON pj.printer_id = p.id
    WHERE pj.id = p_job_id;

    IF v_target_seq IS NULL THEN
        RETURN;
    END IF;

    -- Count active jobs ahead in queue for the same printer
    SELECT COUNT(*) INTO v_jobs_ahead
    FROM print_jobs
    WHERE printer_id = v_printer_id
      AND status IN ('QUEUED', 'DISPATCHED', 'ACKNOWLEDGED', 'SUBMITTED_TO_CUPS', 'PRINTING')
      AND (
          queue_sequence < v_target_seq 
          OR (queue_sequence = v_target_seq AND id != p_job_id)
      );

    RETURN QUERY
    SELECT 
        p_job_id,
        v_printer_id,
        COALESCE(v_printer_name, 'Assigned Printer')::VARCHAR(100),
        v_target_seq,
        v_jobs_ahead,
        (v_jobs_ahead + 1)::BIGINT,
        v_status,
        CASE 
            WHEN v_status = 'CREATED' THEN 'Waiting for payment confirmation'
            WHEN v_status = 'PAYMENT_PENDING' THEN 'Waiting for payment confirmation'
            WHEN v_status = 'PAYMENT_VERIFIED' THEN 'Payment verified'
            WHEN v_status = 'QUEUED' AND v_jobs_ahead = 0 THEN 'Your document is next in queue'
            WHEN v_status = 'QUEUED' THEN 'Added to print queue'
            WHEN v_status IN ('DISPATCHED', 'ACKNOWLEDGED') THEN 'Printer is preparing your document'
            WHEN v_status IN ('SUBMITTED_TO_CUPS', 'PRINTING') THEN 'Printing started'
            WHEN v_status = 'COMPLETED' THEN 'Printing completed'
            WHEN v_status = 'PRINTER_OFFLINE' THEN 'Printer temporarily offline'
            WHEN v_status IN ('FAILED', 'RECOVERY_REQUIRED') THEN 'Print failed — assistance required'
            WHEN v_status = 'CANCELLED' THEN 'Job cancelled'
            ELSE v_status
        END::VARCHAR(100),
        -- Estimated 15 seconds per page average for jobs ahead
        (v_jobs_ahead * 20)::INTEGER;
END;
$$ LANGUAGE plpgsql;
