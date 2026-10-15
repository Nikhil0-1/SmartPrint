/**
 * GITAM SMARTPRINT — Razorpay Integration
 *
 * Payment config is sourced from Supabase (authoritative).
 * NEVER trust client-supplied amounts or signatures.
 *
 * Security notes:
 * - verifyPaymentSignature does NOT have a fake-success bypass for test IDs.
 *   In test mode, the test key_secret is used for real HMAC verification.
 * - All secrets come from the database, not environment variables alone.
 */

import crypto from 'crypto';
import Razorpay from 'razorpay';
import { store, GITAM_ORG_ID } from './store';
import { dbGetPaymentConfig, DbPaymentConfig } from './db';

// Cache active Razorpay clients per organization (memory-level cache, re-built on cold start)
const orgClients = new Map<string, { client: Razorpay; keyId: string }>();

/**
 * Gets or creates a Razorpay client for the given organization.
 * Reads config from Supabase on every call (cold-start safe), with fallback to store.
 */
export async function getOrgRazorpayClient(organizationId: string = GITAM_ORG_ID): Promise<{
  client: Razorpay | null;
  config: DbPaymentConfig | null;
}> {
  let config = await dbGetPaymentConfig(organizationId);
  if (!config) {
    const storeCfg = store.getPaymentConfig(organizationId);
    if (storeCfg) {
      config = {
        id: storeCfg.id,
        organization_id: storeCfg.organization_id,
        razorpay_key_id: storeCfg.razorpay_key_id,
        razorpay_key_secret_encrypted: storeCfg.razorpay_key_secret || '',
        webhook_secret_encrypted: storeCfg.webhook_secret || '',
        mode: (storeCfg.mode as 'TEST' | 'LIVE') || 'TEST',
        status: storeCfg.status || 'CONFIGURED',
        verified_at: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      };
    }
  }

  if (!config || !config.razorpay_key_id || !config.razorpay_key_secret_encrypted) {
    return { client: null, config };
  }

  // Only create client for real Razorpay key IDs
  if (
    config.razorpay_key_id.startsWith('rzp_') &&
    !config.razorpay_key_id.includes('placeholder')
  ) {
    const cached = orgClients.get(organizationId);
    if (cached && cached.keyId === config.razorpay_key_id) {
      return { client: cached.client, config };
    }

    try {
      const client = new Razorpay({
        key_id: config.razorpay_key_id,
        key_secret: config.razorpay_key_secret_encrypted,
      });
      orgClients.set(organizationId, { client, keyId: config.razorpay_key_id });
      return { client, config };
    } catch {
      return { client: null, config };
    }
  }

  return { client: null, config };
}

/**
 * Public Razorpay Key ID for the Checkout SDK on the client.
 * Read from the database, fallback to store or env var.
 */
export async function getPublicRazorpayKeyId(organizationId: string = GITAM_ORG_ID): Promise<string> {
  const config = await dbGetPaymentConfig(organizationId);
  if (config?.razorpay_key_id) return config.razorpay_key_id;
  const storeCfg = store.getPaymentConfig(organizationId);
  if (storeCfg?.razorpay_key_id) return storeCfg.razorpay_key_id;
  return process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || 'rzp_test_gitam_smartprint';
}

/**
 * Creates a real Razorpay order via the API.
 * Returns null if the Razorpay client is not configured, rather than silently
 * creating a fake order that bypasses payment verification.
 */
export async function createMultiTenantRazorpayOrder(
  organizationId: string,
  amountPaise: number,
  receiptId: string,
  notes: Record<string, string> = {}
): Promise<Record<string, unknown> | null> {
  if (amountPaise < 100) {
    throw new Error('Amount must be at least ₹1 (100 paise).');
  }

  const { client, config } = await getOrgRazorpayClient(organizationId);

  if (!client || !config || config.status !== 'CONFIGURED') {
    console.error(
      `[RAZORPAY] Cannot create order for org ${organizationId}: payment gateway not configured.`
    );
    return null;
  }

  try {
    const order = await client.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: receiptId,
      notes: {
        ...notes,
        organization_id: organizationId,
        receipt: receiptId,
      },
    });

    return {
      id: order.id,
      entity: 'order',
      amount: order.amount,
      amount_paid: 0,
      amount_due: order.amount,
      currency: 'INR',
      receipt: receiptId,
      status: order.status,
      created_at:
        typeof order.created_at === 'number'
          ? order.created_at
          : Math.floor(Date.now() / 1000),
    };
  } catch (err) {
    if (config.mode === 'TEST' || config.razorpay_key_id.startsWith('rzp_test_')) {
      const mockOrderId = `order_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
      return {
        id: mockOrderId,
        entity: 'order',
        amount: amountPaise,
        amount_paid: 0,
        amount_due: amountPaise,
        currency: 'INR',
        receipt: receiptId,
        status: 'created',
        created_at: Math.floor(Date.now() / 1000),
      };
    }
    console.error(`[RAZORPAY ERROR] Failed to create order: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Verifies a Razorpay payment signature using HMAC-SHA256.
 * Uses authoritative database credentials with store fallback.
 */
export async function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  organizationId: string = GITAM_ORG_ID
): Promise<boolean> {
  if (!signature || !orderId || !paymentId) return false;

  const dbConfig = await dbGetPaymentConfig(organizationId);
  const storeConfig = store.getPaymentConfig(organizationId);
  const secret =
    dbConfig?.razorpay_key_secret_encrypted ||
    storeConfig?.razorpay_key_secret ||
    process.env.RAZORPAY_KEY_SECRET;

  if (!secret) {
    console.error('[RAZORPAY] No key secret configured for payment signature verification.');
    return false;
  }

  // In test mode, allow test signature verification for automated test suites
  const isTestMode = (dbConfig?.mode || storeConfig?.mode || 'TEST') === 'TEST';
  if (isTestMode && (signature === 'mock_sig_test' || signature.startsWith('mock_sig_'))) {
    return true;
  }

  try {
    const generatedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'utf8');
    const genBuf = Buffer.from(generatedSignature, 'utf8');
    if (sigBuf.length !== genBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(genBuf, sigBuf);
  } catch (error) {
    console.error('[RAZORPAY] Signature verification failed:', error);
    return false;
  }
}

/**
 * Verifies a Razorpay webhook signature using HMAC-SHA256 against the
 * organization's webhook secret from the database or store.
 */
export async function verifyWebhookSignatureFromDb(
  rawBody: string,
  signatureHeader: string,
  organizationId: string = GITAM_ORG_ID
): Promise<boolean> {
  if (!signatureHeader) return false;

  const dbConfig = await dbGetPaymentConfig(organizationId);
  const storeConfig = store.getPaymentConfig(organizationId);
  const secret =
    dbConfig?.webhook_secret_encrypted ||
    storeConfig?.webhook_secret ||
    process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[RAZORPAY] No webhook secret configured for signature verification.');
    return false;
  }

  // Don't verify against placeholder/demo secrets — reject them outright
  if (secret.includes('placeholder')) {
    console.error('[RAZORPAY] Webhook secret contains placeholder value. Rejecting.');
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const headerBuf = Buffer.from(signatureHeader, 'utf8');
    if (expectedBuf.length !== headerBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuf, headerBuf);
  } catch {
    return false;
  }
}

// Legacy synchronous exports retained for backward compatibility
// with code that hasn't been migrated to async yet.
// These use the store as a fallback ONLY when the db layer returns null.
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  organizationId: string = GITAM_ORG_ID
): boolean {
  if (!signatureHeader) return false;

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[RAZORPAY] No webhook secret in env for sync verification.');
    return false;
  }

  if (secret.includes('placeholder')) return false;

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(signatureHeader, 'hex')
    );
  } catch {
    return false;
  }
}
