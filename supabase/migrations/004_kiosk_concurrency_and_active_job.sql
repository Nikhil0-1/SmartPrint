-- ==============================================================================
-- GITAM SMARTPRINT - MIGRATION 004: KIOSK CONCURRENCY & STRICT ACTIVE JOB STATE
-- Enforces one active customer print workflow per physical kiosk.
-- Adds active_job_id foreign key, atomic reservation & release stored procedures.
-- ==============================================================================

-- 1. ADD active_job_id TO KIOSKS TABLE
ALTER TABLE kiosks ADD COLUMN IF NOT EXISTS active_job_id VARCHAR(50);

-- Foreign key to print_jobs
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_kiosks_active_job'
    ) THEN
        ALTER TABLE kiosks 
        ADD CONSTRAINT fk_kiosks_active_job 
        FOREIGN KEY (active_job_id) REFERENCES print_jobs(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 2. CREATE INDEX FOR RAPID CONCURRENCY CHECKS
CREATE INDEX IF NOT EXISTS idx_kiosks_active_job ON kiosks(active_job_id);

-- 3. ATOMIC RESERVATION FUNCTION
-- Returns TRUE if reservation was acquired, FALSE if kiosk is already serving an active customer.
CREATE OR REPLACE FUNCTION reserve_kiosk_for_job(p_kiosk_id VARCHAR(50), p_job_id VARCHAR(50))
RETURNS BOOLEAN AS $$
DECLARE
    v_current_active_job VARCHAR(50);
    v_job_status VARCHAR(50);
BEGIN
    -- Select for update to lock the kiosk row
    SELECT active_job_id INTO v_current_active_job
    FROM kiosks
    WHERE id = p_kiosk_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- If there's an existing active job, verify its status
    IF v_current_active_job IS NOT NULL AND v_current_active_job <> p_job_id THEN
        SELECT status INTO v_job_status
        FROM print_jobs
        WHERE id = v_current_active_job;

        -- If existing job is still active, reject reservation
        IF v_job_status IN (
            'CREATED', 'UPLOAD_COMPLETE', 'VALIDATING', 'PAYMENT_PENDING',
            'PAYMENT_VERIFIED', 'QUEUED', 'DEVICE_ACCEPTED', 'DOWNLOADING',
            'PROCESSING', 'SUBMITTED_TO_CUPS', 'PRINTING'
        ) THEN
            RETURN FALSE;
        END IF;
    END IF;

    -- Acquire reservation
    UPDATE kiosks
    SET active_job_id = p_job_id
    WHERE id = p_kiosk_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 4. ATOMIC RELEASE FUNCTION
CREATE OR REPLACE FUNCTION release_kiosk_job(p_kiosk_id VARCHAR(50), p_job_id VARCHAR(50))
RETURNS VOID AS $$
BEGIN
    UPDATE kiosks
    SET active_job_id = NULL
    WHERE id = p_kiosk_id AND (active_job_id = p_job_id OR p_job_id IS NULL);
END;
$$ LANGUAGE plpgsql;

-- 5. REALTIME REPLICATION PUBLICATION ENHANCEMENT
-- Ensure kiosks and print_jobs are included in supabase_realtime publication
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE kiosks;
        ALTER PUBLICATION supabase_realtime ADD TABLE print_jobs;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        -- Table already in publication
        NULL;
END $$;
