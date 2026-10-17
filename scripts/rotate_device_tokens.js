const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const kiosk1Token = generateSecureToken();
const kiosk2Token = generateSecureToken();

const kiosk1Hash = hashToken(kiosk1Token);
const kiosk2Hash = hashToken(kiosk2Token);

// Output env file for Raspberry Pi provisioning (mode 0600)
const envContent = [
  '# GITAM SMARTPRINT - ROTATED DEVICE CREDENTIALS',
  '# PROVISION THIS FILE SECURELY ON THE RASPBERRY PI AT /etc/smartprint/device.env',
  '# PERMISSIONS MUST BE RESTRICTED TO CHMOD 0600',
  `KIOSK_001_ID=GITAM-SPK-001`,
  `KIOSK_001_TOKEN=${kiosk1Token}`,
  `KIOSK_002_ID=GITAM-SPK-002`,
  `KIOSK_002_TOKEN=${kiosk2Token}`,
  '',
].join('\n');

const outPath = path.join(__dirname, '..', 'device_credentials.env');
fs.writeFileSync(outPath, envContent, { mode: 0o600 });

// Output SQL query to apply to Supabase
const sql = `
UPDATE public.kiosks SET device_token_hash = '${kiosk1Hash}', updated_at = NOW() WHERE id = 'GITAM-SPK-001';
UPDATE public.kiosks SET device_token_hash = '${kiosk2Hash}', updated_at = NOW() WHERE id = 'GITAM-SPK-002';
UPDATE public.devices SET device_token_hash = '${kiosk1Hash}', updated_at = NOW() WHERE kiosk_id = 'GITAM-SPK-001';
`;

console.log(JSON.stringify({
  success: true,
  message: 'Device tokens successfully rotated into local device_credentials.env (0600)',
  kiosk1_hash: kiosk1Hash,
  kiosk2_hash: kiosk2Hash,
  sql: sql.trim()
}));
