-- ==============================================================================
-- GITAM SMARTPRINT - MIGRATION 007: DATABASE PRODUCTION FIXES
-- Fixes all 500 errors: pricing write failure, RLS blocking service_role writes
-- on pricing/branding/kiosks/printers/audit-logs/system-logs tables.
-- Safe to re-run (all idempotent).
-- ==============================================================================

-- --- 1. FIX RLS ON pricing TABLE ---------------------------------------------
DROP POLICY IF EXISTS "Public Read Pricing" ON pricing;
DROP POLICY IF EXISTS "Service Role Pricing Full" ON pricing;
CREATE POLICY "Public Read Pricing" ON pricing FOR SELECT USING (true);
CREATE POLICY "Service Role Pricing Full" ON pricing FOR ALL USING (auth.role() = ''service_role'');

-- --- 2. FIX RLS ON branding TABLE --------------------------------------------
DROP POLICY IF EXISTS "Public Read Branding" ON branding;
DROP POLICY IF EXISTS "Service Role Branding Full" ON branding;
CREATE POLICY "Public Read Branding" ON branding FOR SELECT USING (true);
CREATE POLICY "Service Role Branding Full" ON branding FOR ALL USING (auth.role() = ''service_role'');

-- --- 3. FIX RLS ON kiosks TABLE ----------------------------------------------
DROP POLICY IF EXISTS "Public Read Kiosks" ON kiosks;
DROP POLICY IF EXISTS "Service Role Kiosks Full" ON kiosks;
CREATE POLICY "Public Read Kiosks" ON kiosks FOR SELECT USING (true);
CREATE POLICY "Service Role Kiosks Full" ON kiosks FOR ALL USING (auth.role() = ''service_role'');

-- --- 4. FIX RLS ON printers TABLE --------------------------------------------
DROP POLICY IF EXISTS "Public Read Printers" ON printers;
DROP POLICY IF EXISTS "Service Role Printers Full" ON printers;
CREATE POLICY "Public Read Printers" ON printers FOR SELECT USING (true);
CREATE POLICY "Service Role Printers Full" ON printers FOR ALL USING (auth.role() = ''service_role'');

-- --- 5. FIX RLS ON print_jobs TABLE ------------------------------------------
DROP POLICY IF EXISTS "Service Role Jobs Access" ON print_jobs;
DROP POLICY IF EXISTS "Service Role Jobs Full" ON print_jobs;
CREATE POLICY "Service Role Jobs Full" ON print_jobs FOR ALL USING (auth.role() = ''service_role'');

-- --- 6. FIX RLS ON admin_audit_logs TABLE ------------------------------------
ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service Role Audit Full" ON admin_audit_logs;
CREATE POLICY "Service Role Audit Full" ON admin_audit_logs FOR ALL USING (auth.role() = ''service_role'');

-- --- 7. FIX RLS ON system_logs TABLE -----------------------------------------
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service Role SystemLogs Full" ON system_logs;
CREATE POLICY "Service Role SystemLogs Full" ON system_logs FOR ALL USING (auth.role() = ''service_role'');

-- --- 8. FIX RLS ON webhook_events TABLE --------------------------------------
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service Role Webhook Full" ON webhook_events;
CREATE POLICY "Service Role Webhook Full" ON webhook_events FOR ALL USING (auth.role() = ''service_role'');

-- --- 9. FIX RLS ON payment_orders TABLE --------------------------------------
DROP POLICY IF EXISTS "Service Role Payment Orders Full" ON payment_orders;
CREATE POLICY "Service Role Payment Orders Full" ON payment_orders FOR ALL USING (auth.role() = ''service_role'');

-- --- 10. FIX RLS ON payment_transactions TABLE -------------------------------
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service Role Tx Full" ON payment_transactions;
CREATE POLICY "Service Role Tx Full" ON payment_transactions FOR ALL USING (auth.role() = ''service_role'');

-- --- 11. FIX RLS ON organization_members TABLE -------------------------------
DROP POLICY IF EXISTS "Service Role Members Full" ON organization_members;
CREATE POLICY "Service Role Members Full" ON organization_members FOR ALL USING (auth.role() = ''service_role'');

-- --- 12. FIX RLS ON organizations TABLE --------------------------------------
DROP POLICY IF EXISTS "Public Read Active Organizations" ON organizations;
DROP POLICY IF EXISTS "Service Role Organizations Full" ON organizations;
CREATE POLICY "Public Read Active Organizations" ON organizations FOR SELECT USING (status = ''ACTIVE'');
CREATE POLICY "Service Role Organizations Full" ON organizations FOR ALL USING (auth.role() = ''service_role'');

-- --- 13. FIX RLS ON payment_configurations TABLE -----------------------------
DROP POLICY IF EXISTS "Service Role Payment Config Full" ON payment_configurations;
CREATE POLICY "Service Role Payment Config Full" ON payment_configurations FOR ALL USING (auth.role() = ''service_role'');

-- --- 14. FIX RLS ON files TABLE ----------------------------------------------
DROP POLICY IF EXISTS "Service Role Files Access" ON files;
DROP POLICY IF EXISTS "Service Role Files Full" ON files;
CREATE POLICY "Service Role Files Full" ON files FOR ALL USING (auth.role() = ''service_role'');

-- --- 15. FIX RLS ON payments TABLE -------------------------------------------
DROP POLICY IF EXISTS "Service Role Payments Access" ON payments;
DROP POLICY IF EXISTS "Service Role Payments Full" ON payments;
CREATE POLICY "Service Role Payments Full" ON payments FOR ALL USING (auth.role() = ''service_role'');

-- --- 16. FIX RLS ON sessions TABLE -------------------------------------------
DROP POLICY IF EXISTS "Public Session Access" ON sessions;
DROP POLICY IF EXISTS "Service Role Sessions Full" ON sessions;
CREATE POLICY "Public Session Access" ON sessions FOR SELECT USING (true);
CREATE POLICY "Service Role Sessions Full" ON sessions FOR ALL USING (auth.role() = ''service_role'');

-- --- 17. ENSURE pricing HAS organization_id (fresh-install guard) -------------
ALTER TABLE pricing ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE pricing ADD COLUMN IF NOT EXISTS bw_price_paise INTEGER DEFAULT 100;
ALTER TABLE pricing ADD COLUMN IF NOT EXISTS color_price_paise INTEGER DEFAULT 500;
UPDATE pricing SET organization_id = ''00000000-0000-0000-0000-000000000001''::uuid WHERE organization_id IS NULL;

-- --- 18. ENSURE branding HAS organization_id (fresh-install guard) ------------
ALTER TABLE branding ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
UPDATE branding SET organization_id = ''00000000-0000-0000-0000-000000000001''::uuid WHERE organization_id IS NULL;

-- --- 19. SEED DEFAULT PRICING ROW IF MISSING ---------------------------------
INSERT INTO pricing (
    organization_id, bw_price_per_page, color_price_per_page,
    service_charge, min_order_amount, max_pages, max_copies,
    max_file_size_mb, bw_price_paise, color_price_paise, updated_by
)
SELECT
    ''00000000-0000-0000-0000-000000000001''::uuid,
    2.50, 8.00, 0.00, 1.00, 100, 10, 40, 250, 800, ''system''
WHERE NOT EXISTS (
    SELECT 1 FROM pricing
    WHERE organization_id = ''00000000-0000-0000-0000-000000000001''::uuid
);

-- --- 20. GRANT service_role FULL TABLE PERMISSIONS ---------------------------
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Done.
