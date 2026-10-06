-- GITAM SMARTPRINT DATABASE SCHEMA
-- Production-Ready Migration for Kiosk Ecosystem

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. BRANDING TABLE
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
    welcome_message TEXT DEFAULT 'Welcome to GITAM SMARTPRINT kiosk. Scan the QR code to start printing.',
    instructions TEXT DEFAULT '1. Scan QR  2. Upload Document  3. Select Options  4. Pay via UPI  5. Collect Print',
    success_message TEXT DEFAULT 'Your document has been printed successfully. Please collect your pages.',
    maintenance_message TEXT DEFAULT 'GITAM SMARTPRINT is temporarily undergoing maintenance.',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert default branding row if empty
INSERT INTO branding (organization, product, primary_tagline, secondary_tagline, powered_by, support_number)
SELECT 'GITAM', 'SMARTPRINT', 'SCAN. UPLOAD. PAY. PRINT.', 'Smart Campus Printing, Made Simple.', 'Nikhil', '9006496970'
WHERE NOT EXISTS (SELECT 1 FROM branding);

-- 2. PRICING TABLE
CREATE TABLE IF NOT EXISTS pricing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bw_price_per_page NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
    color_price_per_page NUMERIC(10, 2) NOT NULL DEFAULT 5.00,
    service_charge NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    min_order_amount NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
    max_pages INTEGER NOT NULL DEFAULT 100,
    max_copies INTEGER NOT NULL DEFAULT 10,
    max_file_size_mb INTEGER NOT NULL DEFAULT 20,
    updated_by VARCHAR(100) DEFAULT 'System Admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO pricing (bw_price_per_page, color_price_per_page, service_charge, max_pages, max_copies, max_file_size_mb)
SELECT 1.00, 5.00, 0.00, 100, 10, 20
WHERE NOT EXISTS (SELECT 1 FROM pricing);

-- 3. KIOSKS TABLE
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
SELECT 'GITAM-SPK-001', 'Central Kiosk 01', 'GITAM Library Block A', 'sha256_demo_token_hash_001', 'ONLINE'
WHERE NOT EXISTS (SELECT 1 FROM kiosks WHERE id = 'GITAM-SPK-001');

-- 4. PRINTERS TABLE
CREATE TABLE IF NOT EXISTS printers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kiosk_id VARCHAR(50) REFERENCES kiosks(id) ON DELETE CASCADE,
    printer_name VARCHAR(100) NOT NULL DEFAULT 'HP LaserJet Professional',
    model VARCHAR(100) DEFAULT 'HP LaserJet Pro M404dn',
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
SELECT 'GITAM-SPK-001', 'HP LaserJet Pro (Kiosk 01)', 'HP LaserJet 1020 / Pro Series', 'HP_LaserJet_USB', 'READY'
WHERE NOT EXISTS (SELECT 1 FROM printers WHERE kiosk_id = 'GITAM-SPK-001');

-- 5. SESSIONS TABLE (Dynamic QR Code Sessions)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kiosk_id VARCHAR(50) REFERENCES kiosks(id) ON DELETE CASCADE,
    session_token VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, IN_USE, COMPLETED, EXPIRED
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. PRINT JOBS TABLE
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

-- 7. FILES TABLE (Secure Temporary Storage Metadata)
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

-- 8. PAYMENTS TABLE
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

-- 9. ADMIN USERS TABLE
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'OPERATOR', -- SUPER_ADMIN, OPERATOR
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO admin_users (email, password_hash, full_name, role)
SELECT 'admin@gitam.edu', 'pbkdf2_admin_hash_gitam_2026', 'GITAM SmartPrint Admin', 'SUPER_ADMIN'
WHERE NOT EXISTS (SELECT 1 FROM admin_users WHERE email = 'admin@gitam.edu');

-- 10. SYSTEM LOGS TABLE
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

-- 11. AUDIT LOGS TABLE
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

-- INDEXES FOR MAXIMUM QUERY PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_print_jobs_kiosk_status ON print_jobs(kiosk_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_files_job_id ON files(job_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at DESC);

-- RLS POLICIES (Row Level Security)
ALTER TABLE branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE kiosks ENABLE ROW LEVEL SECURITY;
ALTER TABLE printers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

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
