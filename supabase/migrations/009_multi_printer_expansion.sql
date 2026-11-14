-- ==============================================================================
-- GITAM SMARTPRINT - MULTI-PRINTER EXPANSION MIGRATION (009)
-- Upgrades schema to support up to 5+ physical printers per kiosk,
-- hardware identity matching, error history logs, and telemetry tracking.
-- ==============================================================================

-- 1. ADD EXTENDED COLUMNS TO PRINTERS TABLE
ALTER TABLE printers ADD COLUMN IF NOT EXISTS device_uri TEXT;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS hardware_id TEXT;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS last_detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE printers ADD COLUMN IF NOT EXISTS last_successful_print TIMESTAMP WITH TIME ZONE;

-- Create indexes for rapid multi-printer queries and identity matching
CREATE INDEX IF NOT EXISTS idx_printers_kiosk_queue ON printers(kiosk_id, cups_queue_name);
CREATE INDEX IF NOT EXISTS idx_printers_hardware_id ON printers(hardware_id);
CREATE INDEX IF NOT EXISTS idx_printers_kiosk_priority ON printers(kiosk_id, priority ASC);

-- 2. CREATE PRINTER_ERROR_LOGS TABLE
CREATE TABLE IF NOT EXISTS printer_error_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    printer_id UUID REFERENCES printers(id) ON DELETE CASCADE,
    kiosk_id VARCHAR(50) REFERENCES kiosks(id) ON DELETE CASCADE,
    cups_queue_name VARCHAR(100),
    error_state VARCHAR(50) NOT NULL,
    error_message TEXT,
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_printer_errors_printer ON printer_error_logs(printer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_printer_errors_kiosk ON printer_error_logs(kiosk_id, occurred_at DESC);

-- 3. CREATE PRINTER_TELEMETRY TABLE
CREATE TABLE IF NOT EXISTS printer_telemetry (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    printer_id UUID REFERENCES printers(id) ON DELETE CASCADE,
    kiosk_id VARCHAR(50) REFERENCES kiosks(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL,
    cups_state VARCHAR(50),
    cups_reasons TEXT[],
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_printer_telemetry_printer ON printer_telemetry(printer_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_printer_telemetry_kiosk ON printer_telemetry(kiosk_id, recorded_at DESC);

-- 4. RLS POLICIES FOR NEW TABLES
ALTER TABLE printer_error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE printer_telemetry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Printer Error Logs" ON printer_error_logs;
CREATE POLICY "Public Read Printer Error Logs" ON printer_error_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service Role Printer Error Logs" ON printer_error_logs;
CREATE POLICY "Service Role Printer Error Logs" ON printer_error_logs FOR ALL USING (true);

DROP POLICY IF EXISTS "Public Read Printer Telemetry" ON printer_telemetry;
CREATE POLICY "Public Read Printer Telemetry" ON printer_telemetry FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service Role Printer Telemetry" ON printer_telemetry;
CREATE POLICY "Service Role Printer Telemetry" ON printer_telemetry FOR ALL USING (true);

-- 5. SEED CONFIGURATION FOR UP TO 5 PRINTERS ON KIOSK GITAM-SPK-001
-- Printer 1: HP Laser 108w (USB / ipp-usb) - Default Primary B&W
INSERT INTO printers (
    id, kiosk_id, printer_name, display_name, manufacturer, model,
    cups_queue_name, connection_type, device_uri, status, is_default,
    supports_color, supports_duplex, printer_type, enabled, priority, capabilities
)
SELECT 
    '11111111-1111-1111-1111-111111111111'::uuid,
    'GITAM-SPK-001',
    'HP Laser 108w',
    'HP Laser 108w (Primary B&W)',
    'HP',
    'HP Laser 108w',
    'HP_Laser_108w',
    'IPP-USB',
    'ipp://127.0.0.1:60000/ipp/print',
    'READY',
    TRUE,
    FALSE,
    FALSE,
    'BW',
    TRUE,
    1,
    '{"color": false, "duplex": false, "paper_sizes": ["A4"], "resolutions": ["600dpi"]}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM printers WHERE id = '11111111-1111-1111-1111-111111111111'::uuid
    OR (kiosk_id = 'GITAM-SPK-001' AND cups_queue_name = 'HP_Laser_108w')
);

-- Printer 2: HP Color LaserJet Pro M454dn (Color Primary)
INSERT INTO printers (
    id, kiosk_id, printer_name, display_name, manufacturer, model,
    cups_queue_name, connection_type, device_uri, status, is_default,
    supports_color, supports_duplex, printer_type, enabled, priority, capabilities
)
SELECT 
    '22222222-2222-2222-2222-222222222222'::uuid,
    'GITAM-SPK-001',
    'HP Color LaserJet Pro M454dn',
    'HP Color LaserJet (Primary Color)',
    'HP',
    'HP Color LaserJet Pro M454dn',
    'HP_Color_LaserJet',
    'USB',
    'usb://HP/Color%20LaserJet%20Pro%20M454dn?serial=VND3K0192',
    'READY',
    FALSE,
    TRUE,
    TRUE,
    'COLOR',
    TRUE,
    2,
    '{"color": true, "duplex": true, "paper_sizes": ["A4", "Letter"], "resolutions": ["600dpi", "1200dpi"]}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM printers WHERE id = '22222222-2222-2222-2222-222222222222'::uuid
    OR (kiosk_id = 'GITAM-SPK-001' AND cups_queue_name = 'HP_Color_LaserJet')
);

-- Printer 3: HP LaserJet Enterprise M507 (B&W Backup)
INSERT INTO printers (
    id, kiosk_id, printer_name, display_name, manufacturer, model,
    cups_queue_name, connection_type, device_uri, status, is_default,
    supports_color, supports_duplex, printer_type, enabled, priority, capabilities
)
SELECT 
    '33333333-3333-3333-3333-333333333333'::uuid,
    'GITAM-SPK-001',
    'HP LaserJet Enterprise M507',
    'HP LaserJet M507 (Backup B&W)',
    'HP',
    'HP LaserJet Enterprise M507',
    'HP_LaserJet_Backup',
    'USB',
    'usb://HP/LaserJet%20Enterprise%20M507?serial=PHB4M0098',
    'READY',
    FALSE,
    FALSE,
    TRUE,
    'BACKUP',
    TRUE,
    3,
    '{"color": false, "duplex": true, "paper_sizes": ["A4", "Legal"], "resolutions": ["1200dpi"]}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM printers WHERE id = '33333333-3333-3333-3333-333333333333'::uuid
    OR (kiosk_id = 'GITAM-SPK-001' AND cups_queue_name = 'HP_LaserJet_Backup')
);

-- Printer 4: Epson EcoTank L3250 (Network Color Backup)
INSERT INTO printers (
    id, kiosk_id, printer_name, display_name, manufacturer, model,
    cups_queue_name, connection_type, device_uri, status, is_default,
    supports_color, supports_duplex, printer_type, enabled, priority, capabilities
)
SELECT 
    '44444444-4444-4444-4444-444444444444'::uuid,
    'GITAM-SPK-001',
    'Epson EcoTank L3250',
    'Epson EcoTank (Network Color Backup)',
    'Epson',
    'Epson EcoTank L3250 Series',
    'Epson_EcoTank_Color',
    'NETWORK',
    'ipp://192.168.1.150:631/printers/Epson_EcoTank',
    'READY',
    FALSE,
    TRUE,
    FALSE,
    'BACKUP',
    TRUE,
    4,
    '{"color": true, "duplex": false, "paper_sizes": ["A4", "4x6"], "resolutions": ["5760x1440dpi"]}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM printers WHERE id = '44444444-4444-4444-4444-444444444444'::uuid
    OR (kiosk_id = 'GITAM-SPK-001' AND cups_queue_name = 'Epson_EcoTank_Color')
);

-- Printer 5: Brother HL-L2350DW (Network Duplex Mono)
INSERT INTO printers (
    id, kiosk_id, printer_name, display_name, manufacturer, model,
    cups_queue_name, connection_type, device_uri, status, is_default,
    supports_color, supports_duplex, printer_type, enabled, priority, capabilities
)
SELECT 
    '55555555-5555-5555-5555-555555555555'::uuid,
    'GITAM-SPK-001',
    'Brother HL-L2350DW',
    'Brother HL-L2350DW (Duplex Mono)',
    'Brother',
    'Brother HL-L2350DW series',
    'Brother_Duplex_Mono',
    'NETWORK',
    'ipp://192.168.1.160:631/printers/Brother_HL',
    'READY',
    FALSE,
    FALSE,
    TRUE,
    'BW',
    TRUE,
    5,
    '{"color": false, "duplex": true, "paper_sizes": ["A4", "Letter"], "resolutions": ["2400x600dpi"]}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM printers WHERE id = '55555555-5555-5555-5555-555555555555'::uuid
    OR (kiosk_id = 'GITAM-SPK-001' AND cups_queue_name = 'Brother_Duplex_Mono')
);

-- 6. VERIFY OR CREATE PRINTER ROUTING CONFIGURATION FOR GITAM-SPK-001
INSERT INTO printer_routing (
    kiosk_id,
    bw_primary_printer_id,
    bw_backup_printer_id,
    color_primary_printer_id,
    color_backup_printer_id,
    auto_backup_enabled
)
VALUES (
    'GITAM-SPK-001',
    '11111111-1111-1111-1111-111111111111'::uuid,
    '33333333-3333-3333-3333-333333333333'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid,
    '44444444-4444-4444-4444-444444444444'::uuid,
    TRUE
)
ON CONFLICT (kiosk_id) DO UPDATE SET
    bw_primary_printer_id = COALESCE(printer_routing.bw_primary_printer_id, EXCLUDED.bw_primary_printer_id),
    bw_backup_printer_id = COALESCE(printer_routing.bw_backup_printer_id, EXCLUDED.bw_backup_printer_id),
    color_primary_printer_id = COALESCE(printer_routing.color_primary_printer_id, EXCLUDED.color_primary_printer_id),
    color_backup_printer_id = COALESCE(printer_routing.color_backup_printer_id, EXCLUDED.color_backup_printer_id),
    auto_backup_enabled = EXCLUDED.auto_backup_enabled,
    updated_at = CURRENT_TIMESTAMP;
