import crypto from 'crypto';
import Razorpay from 'razorpay';
import { store, GITAM_ORG_ID } from './store';
import { PaymentConfiguration } from './types';

// Cache active Razorpay clients per organization
const orgClients = new Map<string, Razorpay>();

export function getOrgRazorpayClient(organizationId: string = GITAM_ORG_ID): {
  client: Razorpay | null;
  config: PaymentConfiguration | undefined;
} {
  const config = store.getPaymentConfig(organizationId);
  if (!config || !config.razorpay_key_id || !config.razorpay_key_secret) {
    return { client: null, config };
  }

  // If credentials are valid real keys
  if (
    config.razorpay_key_id.startsWith('rzp_') &&
    !config.razorpay_key_id.includes('placeholder')
  ) {
    let client = orgClients.get(organizationId);
    if (!client) {
      client = new Razorpay({
        key_id: config.razorpay_key_id,
        key_secret: config.razorpay_key_secret,
      });
      orgClients.set(organizationId, client);
    }
    return { client, config };
  }

  return { client: null, config };
}

export function getPublicRazorpayKeyId(organizationId: string = GITAM_ORG_ID): string {
  const config = store.getPaymentConfig(organizationId);
  return config?.razorpay_key_id || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || 'rzp_test_gitam_smartprint';
}

export async function createMultiTenantRazorpayOrder(
  organizationId: string,
  amountPaise: number,
  receiptId: string,
  notes: Record<string, string> = {}
) {
  const { client, config } = getOrgRazorpayClient(organizationId);

  // If real configured provider client exists
  if (client && config && config.status === 'CONFIGURED') {
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
        created_at: typeof order.created_at === 'number' ? order.created_at : Math.floor(Date.now() / 1000),
      };
    } catch (err) {
      console.error(`[RAZORPAY ERROR] Real order creation failed for org ${organizationId}:`, err);
    }
  }

  // No valid Razorpay credentials configured — fail with a clear error
  throw new Error('CONFIGURATION_REQUIRED: Razorpay credentials are not configured for this organization. Set up payment credentials in the admin panel.');
}

export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  organizationId: string = GITAM_ORG_ID
): boolean {
  const config = store.getPaymentConfig(organizationId);
  const secret = config?.razorpay_key_secret || process.env.RAZORPAY_KEY_SECRET;

  if (!secret) {
    console.error('[RAZORPAY] No key secret configured for payment signature verification.');
    return false;
  }

  const generatedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(generatedSignature, 'hex'),
    Buffer.from(signature, 'hex')
  );
}

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  organizationId: string = GITAM_ORG_ID
): boolean {
  if (!signatureHeader) return false;

  const config = store.getPaymentConfig(organizationId);
  const secret = config?.webhook_secret || process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[RAZORPAY] No webhook secret configured for signature verification.');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(signatureHeader, 'hex')
    );
  } catch {
    return false;
  }
}
