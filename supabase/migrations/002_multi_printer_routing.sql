-- ==============================================================================
-- GITAM SMARTPRINT - MULTI-PRINTER & ROUTING MIGRATION (002)
-- Expands schema for Multi-Printer Architecture, Capability Detection & Routing
-- ==============================================================================

-- 1. ADD MISSING COLUMNS TO PRINTERS TABLE
ALTER TABLE printers ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);
ALTER TABLE printers ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(100) DEFAULT 'HP';
ALTER TABLE printers ADD COLUMN IF NOT EXISTS printer_type VARCHAR(20) DEFAULT 'BW'; -- BW, COLOR, BOTH, BACKUP
ALTER TABLE printers ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '{"color": false, "duplex": true, "paper_sizes": ["A4"], "resolutions": ["600dpi"]}'::jsonb;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 1;

-- Backfill display_name if null
UPDATE printers SET display_name = printer_name WHERE display_name IS NULL;

-- 2. CREATE PRINTER_CAPABILITIES TABLE
CREATE TABLE IF NOT EXISTS printer_capabilities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    printer_id UUID REFERENCES printers(id) ON DELETE CASCADE,
    color_supported BOOLEAN DEFAULT FALSE,
    grayscale_supported BOOLEAN DEFAULT TRUE,
    duplex_supported BOOLEAN DEFAULT FALSE,
    paper_sizes JSONB DEFAULT '["A4"]'::jsonb,
    resolutions JSONB DEFAULT '["600dpi"]'::jsonb,
    cups_state VARCHAR(50) DEFAULT 'idle',
    queue_state VARCHAR(50) DEFAULT 'enabled',
    last_detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. CREATE PRINTER_ROUTING TABLE
CREATE TABLE IF NOT EXISTS printer_routing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kiosk_id VARCHAR(50) REFERENCES kiosks(id) ON DELETE CASCADE,
    bw_primary_printer_id UUID REFERENCES printers(id) ON DELETE SET NULL,
    bw_backup_printer_id UUID REFERENCES printers(id) ON DELETE SET NULL,
    color_primary_printer_id UUID REFERENCES printers(id) ON DELETE SET NULL,
    color_backup_printer_id UUID REFERENCES printers(id) ON DELETE SET NULL,
    auto_backup_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_kiosk_routing UNIQUE (kiosk_id)
);

-- Insert sample default printers for GITAM-SPK-001 (Multi-Printer Kiosk Setup)
-- Printer 1: HP LaserJet Pro M404dn (B&W)
INSERT INTO printers (id, kiosk_id, printer_name, display_name, manufacturer, model, cups_queue_name, connection_type, status, is_default, supports_color, supports_duplex, printer_type, enabled, priority)
SELECT 
    '11111111-1111-1111-1111-111111111111'::uuid, 
    'GITAM-SPK-001', 
    'HP LaserJet Pro M404dn', 
    'HP B&W Main Printer', 
    'HP', 
    'HP LaserJet Pro M404dn (USB)', 
    'smartprint_bw_01', 
    'USB', 
    'READY', 
    TRUE, 
    FALSE, 
    TRUE, 
    'BW', 
    TRUE, 
    1
WHERE NOT EXISTS (SELECT 1 FROM printers WHERE id = '11111111-1111-1111-1111-111111111111'::uuid);

-- Printer 2: HP Color LaserJet Pro M454dn (Color)
INSERT INTO printers (id, kiosk_id, printer_name, display_name, manufacturer, model, cups_queue_name, connection_type, status, is_default, supports_color, supports_duplex, printer_type, enabled, priority)
SELECT 
    '22222222-2222-2222-2222-222222222222'::uuid, 
    'GITAM-SPK-001', 
    'HP Color LaserJet Pro M454dn', 
    'HP Color Main Printer', 
    'HP', 
    'HP Color LaserJet Pro M454dn (USB)', 
    'smartprint_color_01', 
    'USB', 
    'READY', 
    FALSE, 
    TRUE, 
    TRUE, 
    'COLOR', 
    TRUE, 
    1
WHERE NOT EXISTS (SELECT 1 FROM printers WHERE id = '22222222-2222-2222-2222-222222222222'::uuid);

-- Printer 3: HP LaserJet Enterprise (B&W Backup)
INSERT INTO printers (id, kiosk_id, printer_name, display_name, manufacturer, model, cups_queue_name, connection_type, status, is_default, supports_color, supports_duplex, printer_type, enabled, priority)
SELECT 
    '33333333-3333-3333-3333-333333333333'::uuid, 
    'GITAM-SPK-001', 
    'HP LaserJet Enterprise M507', 
    'HP B&W Backup Printer', 
    'HP', 
    'HP LaserJet Enterprise M507 (USB)', 
    'smartprint_bw_backup', 
    'USB', 
    'READY', 
    FALSE, 
    FALSE, 
    TRUE, 
    'BACKUP', 
    TRUE, 
    2
WHERE NOT EXISTS (SELECT 1 FROM printers WHERE id = '33333333-3333-3333-3333-333333333333'::uuid);

-- Configure Routing for GITAM-SPK-001
INSERT INTO printer_routing (kiosk_id, bw_primary_printer_id, bw_backup_printer_id, color_primary_printer_id, color_backup_printer_id, auto_backup_enabled)
SELECT 
    'GITAM-SPK-001',
    '11111111-1111-1111-1111-111111111111'::uuid,
    '33333333-3333-3333-3333-333333333333'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid,
    NULL,
    TRUE
ON CONFLICT (kiosk_id) DO NOTHING;

-- RLS POLICIES FOR PRINTER ROUTING & CAPABILITIES
ALTER TABLE printer_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE printer_routing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Read Printer Capabilities" ON printer_capabilities FOR SELECT USING (true);
CREATE POLICY "Public Read Printer Routing" ON printer_routing FOR SELECT USING (true);
CREATE POLICY "Service Role Printer Routing Access" ON printer_routing FOR ALL USING (true);
CREATE POLICY "Service Role Printer Capabilities Access" ON printer_capabilities FOR ALL USING (true);
