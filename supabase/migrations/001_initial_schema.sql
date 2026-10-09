-- ==============================================================================
-- GITAM SMARTPRINT - PRODUCTION DATABASE SCHEMA (16 TABLES)
-- Supabase PostgreSQL Migration for Campus Kiosk Ecosystem
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ADMINS TABLE (Mapped to Firebase Authentication UID)
CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firebase_uid VARCHAR(128) UNIQUE NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED, INVITED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE
);

INSERT INTO admins (firebase_uid, email, full_name, status)
SELECT 'firebase_admin_super_001', 'admin@gitam.edu', 'GITAM SmartPrint Super Admin', 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM admins WHERE email = 'admin@gitam.edu');

-- 2. ADMIN ROLES TABLE
CREATE TABLE IF NOT EXISTS admin_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID REFERENCES admins(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL DEFAULT 'OPERATOR', -- SUPER_ADMIN, OPERATOR
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    assigned_by VARCHAR(150) DEFAULT 'system'
);

INSERT INTO admin_roles (admin_id, role)
SELECT id, 'SUPER_ADMIN' FROM admins WHERE email = 'admin@gitam.edu'
AND NOT EXISTS (SELECT 1 FROM admin_roles WHERE role = 'SUPER_ADMIN');

-- 3. BRANDING TABLE
CREATE TABLE IF NOT EXISTS branding (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization VARCHAR(100) NOT NULL DEFAULT 'GITAM',
    product VARCHAR(100) NOT NULL DEFAULT 'SMARTPRINT',
    primary_tagline VARCHAR(255) NOT NULL DEFAULT 'SCAN. UPLOAD. PAY. PRINT.',
    secondary_tagline VARCHAR(255) NOT NULL DEFAULT 'Smart Campus Printing, Made Simple.',
    powered_by VARCHAR(100) NOT NULL DEFAULT 'Nikhil',
    support_number VARCHAR(20) NOT NULL DEFAULT '9006496970',
    primary_color VARCHAR(20) NOT NULL DEFAULT '#0d253f',
    secondary_color VARCHAR(20) NOT NULL DEFAULT '#1e40af',
    accent_color VARCHAR(20) NOT NULL DEFAULT '#ef4444',
    bg_color VARCHAR(20) NOT NULL DEFAULT '#ffffff',
    logo_url TEXT,
    welcome_message TEXT DEFAULT 'Welcome to GITAM SMARTPRINT. Scan the QR code to start printing quickly and securely from your phone.',
    instructions TEXT DEFAULT '1. Scan Kiosk QR  2. Upload Document  3. Select Options  4. Pay via UPI  5. Collect Document',
    success_message TEXT DEFAULT 'Your document has been printed successfully. Please collect your pages from the printer tray.',
    maintenance_message TEXT DEFAULT 'GITAM SMARTPRINT is temporarily undergoing maintenance. For assistance, contact support.',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO branding (organization, product, primary_tagline, secondary_tagline, powered_by, support_number)
SELECT 'GITAM', 'SMARTPRINT', 'SCAN. UPLOAD. PAY. PRINT.', 'Smart Campus Printing, Made Simple.', 'Nikhil', '9006496970'
WHERE NOT EXISTS (SELECT 1 FROM branding);

-- 4. PRICING TABLE
CREATE TABLE IF NOT EXISTS pricing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bw_price_per_page NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
    color_price_per_page NUMERIC(10, 2) NOT NULL DEFAULT 5.00,
    service_charge NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    min_order_amount NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
    max_pages INTEGER NOT NULL DEFAULT 100,
    max_copies INTEGER NOT NULL DEFAULT 10,
    max_file_size_mb INTEGER NOT NULL DEFAULT 20,
    updated_by VARCHAR(100) DEFAULT 'Nikhil (System Admin)',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO pricing (bw_price_per_page, color_price_per_page, service_charge, max_pages, max_copies, max_file_size_mb)
SELECT 1.00, 5.00, 0.00, 100, 10, 20
WHERE NOT EXISTS (SELECT 1 FROM pricing);

-- 5. SETTINGS TABLE
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO settings (key, value, description)
VALUES 
    ('retention_policy', '{"mode": "IMMEDIATE", "emergency_max_hours": 24}', 'Zero retention document policy'),
    ('webhook_config', '{"provider": "RAZORPAY", "enforce_signature": true}', 'Payment gateway webhook configuration'),
    ('kiosk_defaults', '{"session_timeout_seconds": 900, "screen_refresh_seconds": 2}', 'HDMI screen refresh rates')
ON CONFLICT (key) DO NOTHING;

-- 6. KIOSKS TABLE
CREATE TABLE IF NOT EXISTS kiosks (
    id VARCHAR(50) PRIMARY KEY, -- e.g. GITAM-SPK-001
    name VARCHAR(100) NOT NULL,
    location VARCHAR(200) NOT NULL DEFAULT 'GITAM Campus Main Library',
    device_token_hash VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OFFLINE', -- ONLINE, OFFLINE, MAINTENANCE, DISABLED
    ip_address VARCHAR(45),
    mac_address VARCHAR(17),
    last_heartbeat TIMESTAMP WITH TIME ZONE,
    cpu_temp_celsius NUMERIC(5, 2),
    ram_usage_percent NUMERIC(5, 2),
    disk_usage_percent NUMERIC(5, 2),
    agent_version VARCHAR(20) DEFAULT '1.0.0',
    maintenance_mode BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO kiosks (id, name, location, device_token_hash, status)
SELECT 'GITAM-SPK-001', 'Central Library Kiosk 01', 'Knowledge Resource Centre (Ground Floor)', 'gitam_spk_001_secure_device_secret_2026', 'ONLINE'
WHERE NOT EXISTS (SELECT 1 FROM kiosks WHERE id = 'GITAM-SPK-001');

INSERT INTO kiosks (id, name, location, device_token_hash, status)
SELECT 'GITAM-SPK-002', 'ICT Bhavan Kiosk 02', 'Engineering Block - 2nd Floor Corridor', 'gitam_spk_002_secure_device_secret_2026', 'ONLINE'
WHERE NOT EXISTS (SELECT 1 FROM kiosks WHERE id = 'GITAM-SPK-002');

-- 7. PRINTERS TABLE
CREATE TABLE IF NOT EXISTS printers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kiosk_id VARCHAR(50) REFERENCES kiosks(id) ON DELETE CASCADE,
    printer_name VARCHAR(100) NOT NULL DEFAULT 'HP LaserJet Pro M404dn',
    model VARCHAR(100) DEFAULT 'HP LaserJet Series (USB 2.0)',
    cups_queue_name VARCHAR(100) NOT NULL DEFAULT 'HP_LaserJet_USB',
    connection_type VARCHAR(20) NOT NULL DEFAULT 'USB',
    status VARCHAR(20) NOT NULL DEFAULT 'READY', -- READY, PRINTING, BUSY, ERROR, PAPER_OUT, OFFLINE
    is_default BOOLEAN DEFAULT TRUE,
    supports_color BOOLEAN DEFAULT TRUE,
    supports_duplex BOOLEAN DEFAULT TRUE,
    last_test_print TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO printers (kiosk_id, printer_name, model, cups_queue_name, status)
SELECT 'GITAM-SPK-001', 'HP LaserJet Pro M404dn', 'HP LaserJet Series (USB 2.0)', 'HP_LaserJet_USB', 'READY'
WHERE NOT EXISTS (SELECT 1 FROM printers WHERE kiosk_id = 'GITAM-SPK-001');

-- 8. SESSIONS TABLE (Dynamic QR Code Sessions)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kiosk_id VARCHAR(50) REFERENCES kiosks(id) ON DELETE CASCADE,
    session_token VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, IN_USE, COMPLETED, EXPIRED
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. PRINT JOBS TABLE
CREATE TABLE IF NOT EXISTS print_jobs (
    id VARCHAR(50) PRIMARY KEY, -- SP-20261006-XXXX
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    kiosk_id VARCHAR(50) REFERENCES kiosks(id) ON DELETE RESTRICT,
    printer_id UUID REFERENCES printers(id) ON DELETE SET NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'CREATED',
    -- States: CREATED, UPLOAD_COMPLETE, PAYMENT_PENDING, PAYMENT_VERIFIED, QUEUED, DOWNLOADING, PROCESSING, SUBMITTED_TO_CUPS, PRINTING, PRINTED, CLEANUP_PENDING, COMPLETED, FAILED, RECOVERY_REQUIRED, CANCELLED, EXPIRED
    pages_total INTEGER NOT NULL DEFAULT 1,
    pages_selected VARCHAR(100) DEFAULT 'All',
    copies INTEGER NOT NULL DEFAULT 1,
    is_color BOOLEAN NOT NULL DEFAULT FALSE,
    is_duplex BOOLEAN NOT NULL DEFAULT FALSE,
    orientation VARCHAR(20) NOT NULL DEFAULT 'portrait', -- portrait, landscape
    paper_size VARCHAR(10) NOT NULL DEFAULT 'A4',
    calculated_amount NUMERIC(10, 2) NOT NULL,
    idempotency_key VARCHAR(100) UNIQUE NOT NULL,
    payment_id VARCHAR(100),
    print_attempt_id VARCHAR(100),
    cups_job_id INTEGER,
    error_message TEXT,
    recovery_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- 10. PRINT ATTEMPTS TABLE (Audit trail of print executions)
CREATE TABLE IF NOT EXISTS print_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id VARCHAR(50) REFERENCES print_jobs(id) ON DELETE CASCADE,
    cups_job_id INTEGER,
    status VARCHAR(30) NOT NULL, -- INITIATED, SUCCESS, FAILED
    error_details TEXT,
    attempt_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. FILES TABLE (Secure Temporary Storage Metadata)
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id VARCHAR(50) REFERENCES print_jobs(id) ON DELETE CASCADE,
    storage_path TEXT, -- Nullified after verified deletion!
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'TEMPORARY', -- TEMPORARY, PROCESSING, DELETED, CLEANUP_FAILED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- 12. PAYMENTS TABLE
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id VARCHAR(50) REFERENCES print_jobs(id) ON DELETE RESTRICT,
    razorpay_order_id VARCHAR(100) NOT NULL,
    razorpay_payment_id VARCHAR(100) UNIQUE,
    razorpay_signature VARCHAR(255),
    amount NUMERIC(10, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, SUCCESS, FAILED, REFUNDED
    raw_webhook_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMP WITH TIME ZONE
);

-- 13. SYSTEM LOGS TABLE
CREATE TABLE IF NOT EXISTS system_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    level VARCHAR(20) NOT NULL DEFAULT 'INFO', -- INFO, WARNING, ERROR, CRITICAL
    component VARCHAR(50) NOT NULL, -- RASPBERRY_PI, CUPS, BACKEND, WEBHOOK, CLEANUP, ADMIN
    kiosk_id VARCHAR(50),
    job_id VARCHAR(50),
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 14. ADMIN AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_email VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id VARCHAR(100),
    details JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 15. HEALTH METRICS TABLE (Time-series telemetry from Raspberry Pi fleet)
CREATE TABLE IF NOT EXISTS health_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kiosk_id VARCHAR(50) REFERENCES kiosks(id) ON DELETE CASCADE,
    cpu_temp NUMERIC(5, 2),
    ram_usage NUMERIC(5, 2),
    disk_usage NUMERIC(5, 2),
    printer_status VARCHAR(30),
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 16. NOTIFICATIONS TABLE (Admin alerts for hardware jams, low paper, or offline kiosks)
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kiosk_id VARCHAR(50) REFERENCES kiosks(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'INFO', -- INFO, WARNING, CRITICAL
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- INDEXES FOR MAXIMUM QUERY PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_print_jobs_kiosk_status ON print_jobs(kiosk_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_files_job_id ON files(job_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_metrics_kiosk ON health_metrics(kiosk_id, recorded_at DESC);

-- RLS POLICIES (Row Level Security)
ALTER TABLE branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE kiosks ENABLE ROW LEVEL SECURITY;
ALTER TABLE printers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Allow public read access to branding & pricing for customer web app
CREATE POLICY "Public Read Branding" ON branding FOR SELECT USING (true);
CREATE POLICY "Public Read Pricing" ON pricing FOR SELECT USING (true);
CREATE POLICY "Public Read Kiosks" ON kiosks FOR SELECT USING (true);
CREATE POLICY "Public Read Printers" ON printers FOR SELECT USING (true);
CREATE POLICY "Public Session Access" ON sessions FOR ALL USING (true);

-- Allow backend service role full access
CREATE POLICY "Service Role Jobs Access" ON print_jobs FOR ALL USING (true);
CREATE POLICY "Service Role Files Access" ON files FOR ALL USING (true);
CREATE POLICY "Service Role Payments Access" ON payments FOR ALL USING (true);
CREATE POLICY "Service Role Notifications" ON notifications FOR ALL USING (true);
