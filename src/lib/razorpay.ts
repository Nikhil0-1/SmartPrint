import crypto from 'crypto';

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_gitam_smartprint';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'secret_gitam_smartprint_2026';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'webhook_secret_gitam_smartprint';

export function getRazorpayKeyId(): string {
  return RAZORPAY_KEY_ID;
}

export function createRazorpayOrderMock(amountRupees: number, receiptId: string) {
  // Amount in paise
  const amountPaise = Math.round(amountRupees * 100);
  const orderId = `order_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;

  return {
    id: orderId,
    entity: 'order',
    amount: amountPaise,
    amount_paid: 0,
    amount_due: amountPaise,
    currency: 'INR',
    receipt: receiptId,
    status: 'created',
    attempts: 0,
    created_at: Math.floor(Date.now() / 1000),
  };
}

export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  if (process.env.NODE_ENV !== 'production' && signature.startsWith('mock_sig_')) {
    return true;
  }

  const generatedSignature = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return generatedSignature === signature;
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
  if (!signatureHeader) return false;
  const expectedSignature = crypto
    .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  return expectedSignature === signatureHeader;
}
