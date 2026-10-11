-- ==============================================================================
-- GITAM SMARTPRINT - PRODUCTION MULTI-TENANT ARCHITECTURE MIGRATION (003)
-- Upgrades Single-Tenant schema to complete Multi-Tenant, Multi-Organization Hierarchy
-- Platform Super Admin -> Organization -> Org Admin -> Location -> Kiosk -> Device -> Printer -> Print Job
-- ==============================================================================

-- 1. ORGANIZATIONS TABLE
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(80) UNIQUE NOT NULL,
    logo_url TEXT,
    brand_colors JSONB DEFAULT '{"primary": "#0d253f", "secondary": "#1e40af", "accent": "#ef4444", "bg": "#ffffff"}'::jsonb,
    public_url TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED, ARCHIVED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed default primary organization: GITAM SMARTPRINT
INSERT INTO organizations (id, name, slug, logo_url, status)
SELECT 
    '00000000-0000-0000-0000-000000000001'::uuid, 
    'GITAM SMARTPRINT', 
    'gitam', 
    NULL, 
    'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE slug = 'gitam');

-- Seed second sample organization for Multi-Tenant verification: APNA SMART PRINTER
INSERT INTO organizations (id, name, slug, logo_url, status)
SELECT 
    '00000000-0000-0000-0000-000000000002'::uuid, 
    'APNA SMART PRINTER', 
    'apna', 
    NULL, 
    'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE slug = 'apna');

-- 2. ORGANIZATION MEMBERS / ADMINS
CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    firebase_uid VARCHAR(128) NOT NULL,
    email VARCHAR(150) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'ORG_ADMIN', -- SUPER_ADMIN, ORG_ADMIN, OPERATOR
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, INVITED, SUSPENDED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_org_member UNIQUE (organization_id, email)
);

-- Seed GITAM Admin
INSERT INTO organization_members (organization_id, firebase_uid, email, full_name, role)
SELECT 
    '00000000-0000-0000-0000-000000000001'::uuid, 
    'firebase_admin_super_001', 
    'admin@gitam.edu', 
    'GITAM Platform Super Admin', 
    'SUPER_ADMIN'
WHERE NOT EXISTS (SELECT 1 FROM organization_members WHERE email = 'admin@gitam.edu');

-- Seed APNA Admin (Tenant B isolation)
INSERT INTO organization_members (organization_id, firebase_uid, email, full_name, role)
SELECT 
    '00000000-0000-0000-0000-000000000002'::uuid, 
    'firebase_admin_apna_001', 
    'admin@apnaprint.in', 
    'Apna Print Admin', 
    'ORG_ADMIN'
WHERE NOT EXISTS (SELECT 1 FROM organization_members WHERE email = 'admin@apnaprint.in');

-- 3. LOCATIONS TABLE
CREATE TABLE IF NOT EXISTS locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    address TEXT,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO locations (id, organization_id, name, address, description)
SELECT 
    '10000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Central Library Campus Ground',
    'Knowledge Resource Centre, GITAM Deemed University, Visakhapatnam',
    'Main campus library ground floor kiosk wing'
WHERE NOT EXISTS (SELECT 1 FROM locations WHERE id = '10000000-0000-0000-0000-000000000001'::uuid);

-- 4. ATTACH ORGANIZATION AND LOCATION TO KIOSKS TABLE
ALTER TABLE kiosks ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE kiosks ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE kiosks ADD COLUMN IF NOT EXISTS kiosk_slug VARCHAR(80);

-- Backfill existing kiosks with GITAM Organization ID
UPDATE kiosks 
SET 
    organization_id = '00000000-0000-0000-0000-000000000001'::uuid,
    location_id = '10000000-0000-0000-0000-000000000001'::uuid,
    kiosk_slug = LOWER(id)
WHERE organization_id IS NULL;

-- 5. RASPBERRY PI DEVICES TABLE
CREATE TABLE IF NOT EXISTS devices (
    id VARCHAR(50) PRIMARY KEY, -- e.g. RPI-GITAM-001 or MAC/Serial
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    kiosk_id VARCHAR(50) REFERENCES kiosks(id) ON DELETE SET NULL,
    device_token_hash VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OFFLINE', -- ONLINE, OFFLINE, MAINTENANCE, REVOKED
    ip_address VARCHAR(45),
    mac_address VARCHAR(17),
    last_heartbeat TIMESTAMP WITH TIME ZONE,
    cpu_temp_celsius NUMERIC(5, 2),
    ram_usage_percent NUMERIC(5, 2),
    disk_usage_percent NUMERIC(5, 2),
    agent_version VARCHAR(20) DEFAULT '1.0.0',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO devices (id, organization_id, kiosk_id, device_token_hash, status, agent_version)
SELECT 
    'RPI-GITAM-SPK-001',
    '00000000-0000-0000-0000-000000000001'::uuid,
    'GITAM-SPK-001',
    'gitam_spk_001_secure_device_secret_2026',
    'ONLINE',
    '1.0.0'
WHERE NOT EXISTS (SELECT 1 FROM devices WHERE id = 'RPI-GITAM-SPK-001');

-- 6. ATTACH ORGANIZATION TO PRINTERS TABLE
ALTER TABLE printers ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
UPDATE printers SET organization_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE organization_id IS NULL;

-- 7. ATTACH ORGANIZATION TO BRANDING AND PRICING
ALTER TABLE branding ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
UPDATE branding SET organization_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE organization_id IS NULL;

ALTER TABLE pricing ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE pricing ADD COLUMN IF NOT EXISTS bw_price_paise INTEGER DEFAULT 100;
ALTER TABLE pricing ADD COLUMN IF NOT EXISTS color_price_paise INTEGER DEFAULT 500;
UPDATE pricing SET organization_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE organization_id IS NULL;

-- 8. ORGANIZATION-SPECIFIC RAZORPAY PAYMENT CONFIGURATIONS
CREATE TABLE IF NOT EXISTS payment_configurations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
    razorpay_key_id VARCHAR(100) NOT NULL,
    razorpay_key_secret_encrypted TEXT NOT NULL,
    webhook_secret_encrypted TEXT NOT NULL,
    mode VARCHAR(10) NOT NULL DEFAULT 'TEST', -- TEST, LIVE
    status VARCHAR(30) NOT NULL DEFAULT 'NOT_CONFIGURED', -- NOT_CONFIGURED, PENDING_VERIFICATION, CONFIGURED, VERIFICATION_FAILED, DISABLED
    verified_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed default test credentials for GITAM
INSERT INTO payment_configurations (organization_id, razorpay_key_id, razorpay_key_secret_encrypted, webhook_secret_encrypted, mode, status)
SELECT 
    '00000000-0000-0000-0000-000000000001'::uuid,
    'rzp_test_gitam_smartprint',
    'secret_gitam_smartprint_2026',
    'webhook_secret_gitam_smartprint',
    'TEST',
    'CONFIGURED'
WHERE NOT EXISTS (SELECT 1 FROM payment_configurations WHERE organization_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- 9. PAYMENT ORDERS & TRANSACTIONS (PAISE-ACCURATE)
CREATE TABLE IF NOT EXISTS payment_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    job_id VARCHAR(50) NOT NULL,
    razorpay_order_id VARCHAR(100) UNIQUE NOT NULL,
    amount_paise INTEGER NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'CREATED', -- CREATED, ATTEMPTED, PAID, EXPIRED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    job_id VARCHAR(50) NOT NULL,
    razorpay_order_id VARCHAR(100) NOT NULL,
    razorpay_payment_id VARCHAR(100) UNIQUE NOT NULL,
    amount_paise INTEGER NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS', -- SUCCESS, FAILED, REFUNDED
    verified_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    raw_payload JSONB
);

-- 10. WEBHOOK EVENTS TABLE (STRICT IDEMPOTENCY)
CREATE TABLE IF NOT EXISTS webhook_events (
    id VARCHAR(128) PRIMARY KEY, -- event_id from Razorpay payload
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. ATTACH ORGANIZATION TO SESSIONS & PRINT JOBS
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
UPDATE sessions SET organization_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE organization_id IS NULL;

ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS amount_paise INTEGER;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB;
UPDATE print_jobs 
SET 
    organization_id = '00000000-0000-0000-0000-000000000001'::uuid,
    amount_paise = ROUND(calculated_amount * 100)
WHERE organization_id IS NULL;

-- 12. CLEANUP JOBS QUEUE
CREATE TABLE IF NOT EXISTS cleanup_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    job_id VARCHAR(50) NOT NULL,
    storage_bucket VARCHAR(100) NOT NULL DEFAULT 'smartprint-temporary',
    object_key TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, COMPLETED, FAILED, RETRYING
    attempts INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    executed_at TIMESTAMP WITH TIME ZONE
);

-- 13. DEVICE COMMANDS ALLOWLIST QUEUE
CREATE TABLE IF NOT EXISTS device_commands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(50) REFERENCES devices(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    command_type VARCHAR(50) NOT NULL, -- TEST_PRINT, CANCEL_JOB, RESTART_SERVICE, FLUSH_SPOOL, SYNC_CONFIG
    payload JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, ACKNOWLEDGED, COMPLETED, FAILED, EXPIRED
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    result JSONB
);

-- 14. MULTI-TENANT AUDIT LOGS
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
UPDATE admin_audit_logs SET organization_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE organization_id IS NULL;

-- 15. INDEXES FOR HIGH-THROUGHPUT MULTI-TENANT QUERYING
CREATE INDEX IF NOT EXISTS idx_kiosks_org ON kiosks(organization_id);
CREATE INDEX IF NOT EXISTS idx_printers_org ON printers(organization_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_org ON print_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_payment_orders_job ON payment_orders(job_id);
CREATE INDEX IF NOT EXISTS idx_cleanup_jobs_status ON cleanup_jobs(status);
CREATE INDEX IF NOT EXISTS idx_device_commands_device ON device_commands(device_id, status);

-- 16. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleanup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_commands ENABLE ROW LEVEL SECURITY;

-- Allow public read of active organizations for kiosk and customer routes
CREATE POLICY "Public Read Active Organizations" ON organizations FOR SELECT USING (status = 'ACTIVE');

-- Service role full access
CREATE POLICY "Service Role Organizations Full" ON organizations FOR ALL USING (true);
CREATE POLICY "Service Role Members Full" ON organization_members FOR ALL USING (true);
CREATE POLICY "Service Role Payment Config Full" ON payment_configurations FOR ALL USING (true);
CREATE POLICY "Service Role Payment Orders Full" ON payment_orders FOR ALL USING (true);
CREATE POLICY "Service Role Cleanup Jobs Full" ON cleanup_jobs FOR ALL USING (true);
CREATE POLICY "Service Role Device Commands Full" ON device_commands FOR ALL USING (true);
