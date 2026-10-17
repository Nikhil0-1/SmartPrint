import crypto from 'crypto';
import { dbGetKiosk, dbWriteSystemLog, DbKiosk, DbPrintJob } from './db';
import { isSupabaseConfigured, supabaseAdmin } from './supabase';
import { store } from './store';

export interface DeviceAuthSuccess {
  authenticated: true;
  status: 200;
  kiosk: DbKiosk;
  organizationId?: string;
}

export interface DeviceAuthFailure {
  authenticated: false;
  status: number;
  error: string;
}

export type DeviceAuthResult = DeviceAuthSuccess | DeviceAuthFailure;

/**
 * Computes a deterministic SHA-256 hex digest of a device token.
 */
export function hashDeviceToken(token: string): string {
  if (!token) return '';
  return crypto.createHash('sha256').update(token.trim()).digest('hex').toLowerCase();
}

/**
 * Constant-time comparison of two strings.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Prevent timing leak while returning false
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Securely verifies a presented device token against the stored hash (or legacy plaintext).
 * Supports automatic SHA-256 verification and transparent upgrading of legacy records.
 */
export function verifyDeviceToken(rawToken: string, storedHashOrPlain: string): boolean {
  if (!rawToken || !storedHashOrPlain) return false;
  const cleanRaw = rawToken.trim();
  const cleanStored = storedHashOrPlain.trim();

  // Standard case: stored value is a 64-character SHA-256 hex string
  if (/^[a-f0-9]{64}$/i.test(cleanStored)) {
    const computedHash = hashDeviceToken(cleanRaw);
    return safeCompare(computedHash, cleanStored.toLowerCase());
  }

  // Backward compatibility / migration: stored value is legacy plaintext
  return safeCompare(cleanRaw, cleanStored);
}

/**
 * Shared server-side device authentication helper.
 * Strictly requires X-Kiosk-Id and X-Device-Token headers.
 * Verifies credentials against Supabase.
 * In-memory demo store is NOT permitted to authorize production requests.
 */
export async function authenticateDeviceRequest(request: Request): Promise<DeviceAuthResult> {
  const kioskId = request.headers.get('x-kiosk-id')?.trim();
  const deviceToken = request.headers.get('x-device-token')?.trim();

  if (!kioskId || !deviceToken) {
    return {
      authenticated: false,
      status: 401,
      error: 'Device authentication credentials required: X-Kiosk-Id and X-Device-Token headers must be provided',
    };
  }

  let kiosk: DbKiosk | null = null;

  if (isSupabaseConfigured()) {
    kiosk = await dbGetKiosk(kioskId);
    if (!kiosk) {
      return {
        authenticated: false,
        status: 404,
        error: `Unregistered kiosk device: ${kioskId}`,
      };
    }
  } else {
    // Only in non-production environments with no Supabase configured
    if (process.env.NODE_ENV === 'production') {
      return {
        authenticated: false,
        status: 503,
        error: 'Authoritative database is not configured in production',
      };
    }
    const storeKiosk = store.getKiosk(kioskId);
    if (storeKiosk) {
      kiosk = {
        id: storeKiosk.id,
        name: storeKiosk.name,
        location: storeKiosk.location,
        device_token_hash: storeKiosk.device_token_hash,
        status: storeKiosk.status,
        organization_id: storeKiosk.organization_id || null,
        location_id: null,
        ip_address: null,
        mac_address: null,
        last_heartbeat: storeKiosk.last_heartbeat || null,
        cpu_temp_celsius: null,
        ram_usage_percent: null,
        disk_usage_percent: null,
        agent_version: storeKiosk.agent_version || '1.0.0',
        maintenance_mode: Boolean(storeKiosk.maintenance_mode),
        kiosk_slug: storeKiosk.kiosk_slug || null,
        active_job_id: null,
        updated_at: new Date().toISOString(),
      };
    } else {
      return {
        authenticated: false,
        status: 404,
        error: `Unregistered kiosk device: ${kioskId}`,
      };
    }
  }

  const isValid = verifyDeviceToken(deviceToken, kiosk.device_token_hash);
  if (!isValid) {
    await dbWriteSystemLog({
      level: 'WARNING',
      component: 'DEVICE_AUTH',
      kiosk_id: kioskId,
      message: `Invalid device token presented for kiosk ${kioskId}`,
    });
    return {
      authenticated: false,
      status: 403,
      error: 'Invalid device credentials',
    };
  }

  // If the record was stored as legacy plaintext, upgrade it to SHA-256 hash in the background
  if (!/^[a-f0-9]{64}$/i.test(kiosk.device_token_hash) && isSupabaseConfigured()) {
    const hashed = hashDeviceToken(deviceToken);
    kiosk.device_token_hash = hashed;
    (async () => {
      try {
        await supabaseAdmin
          .from('kiosks')
          .update({ device_token_hash: hashed, updated_at: new Date().toISOString() })
          .eq('id', kiosk.id);

        await supabaseAdmin
          .from('devices')
          .update({ device_token_hash: hashed, updated_at: new Date().toISOString() })
          .eq('kiosk_id', kioskId);
      } catch (err) {
        console.error('[DEVICE_AUTH] Failed to upgrade legacy device token hash:', err);
      }
    })();
  }

  return {
    authenticated: true,
    status: 200,
    kiosk,
    organizationId: kiosk.organization_id || undefined,
  };
}

/**
 * Validates that a target print job belongs to the authenticated kiosk and organization.
 */
export function validateJobScope(
  job: { kiosk_id: string; organization_id?: string | null },
  authKiosk: DbKiosk
): { authorized: boolean; status?: number; error?: string } {
  if (job.kiosk_id !== authKiosk.id) {
    return {
      authorized: false,
      status: 403,
      error: `Forbidden: Job belongs to kiosk '${job.kiosk_id}', not authenticated kiosk '${authKiosk.id}'`,
    };
  }

  if (job.organization_id && authKiosk.organization_id && job.organization_id !== authKiosk.organization_id) {
    return {
      authorized: false,
      status: 403,
      error: 'Forbidden: Organization mismatch between job and kiosk',
    };
  }

  return { authorized: true };
}
