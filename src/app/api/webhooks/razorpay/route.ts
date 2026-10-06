import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { verifyWebhookSignature } from '@/lib/razorpay';

// Cache processed webhook event IDs to guarantee idempotency
const processedEventIds = new Set<string>();

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-razorpay-signature') || '';

    // Verify webhook HMAC signature in production
    if (process.env.NODE_ENV === 'production') {
      const isValid = verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        store.logSystem('CRITICAL', 'WEBHOOK', 'Tampered or invalid Razorpay webhook signature received');
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
      }
    }

    const payload = JSON.parse(rawBody);
    const eventId = payload.event_id || payload.id;
    const event = payload.event;

    // Idempotency check: Ignore duplicate delivery of the exact same event ID
    if (eventId && processedEventIds.has(eventId)) {
      store.logSystem('INFO', 'WEBHOOK', `Duplicate webhook event ID ${eventId} acknowledged without re-processing.`);
      return NextResponse.json({ status: 'ignored_duplicate' });
    }

    if (eventId) {
      processedEventIds.add(eventId);
    }

    if (event === 'order.paid' || event === 'payment.captured') {
      const paymentEntity = payload.payload?.payment?.entity || payload.payload?.order?.entity;
      const orderId = paymentEntity?.order_id || paymentEntity?.id;
      const paymentId = paymentEntity?.id;

      if (orderId && paymentId) {
        store.verifyPayment(orderId, paymentId, signature);
        store.logSystem('INFO', 'WEBHOOK', `Webhook processed for order ${orderId}: Authorized print job.`);
      }
    }

    return NextResponse.json({ status: 'ok', event });
  } catch (error) {
    store.logSystem('ERROR', 'WEBHOOK', `Webhook processing failure: ${(error as Error).message}`);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
