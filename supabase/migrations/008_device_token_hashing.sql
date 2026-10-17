-- ==============================================================================
-- GITAM SMARTPRINT - MIGRATION 008: SECURE DEVICE TOKEN HASHING
-- Safely converts legacy plaintext kiosk/device tokens into SHA-256 digests.
-- Non-destructive and idempotent. Preserves all kiosk and device registrations.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Upgrade legacy plaintext tokens in kiosks table to SHA-256 hex digests
UPDATE public.kiosks
SET 
  device_token_hash = encode(digest(device_token_hash, 'sha256'), 'hex'),
  updated_at = CURRENT_TIMESTAMP
WHERE 
  device_token_hash IS NOT NULL 
  AND length(device_token_hash) != 64;

-- 2. Upgrade legacy plaintext tokens in devices table to SHA-256 hex digests
UPDATE public.devices
SET 
  device_token_hash = encode(digest(device_token_hash, 'sha256'), 'hex'),
  updated_at = CURRENT_TIMESTAMP
WHERE 
  device_token_hash IS NOT NULL 
  AND length(device_token_hash) != 64;

-- 3. Audit log migration completion
INSERT INTO public.system_logs (level, component, message, created_at)
VALUES (
  'INFO', 
  'MIGRATION', 
  'Migration 008: Converted legacy device token records to SHA-256 hashes successfully.', 
  CURRENT_TIMESTAMP
);
