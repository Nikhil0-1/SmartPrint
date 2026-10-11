import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { verifyWebhookSignature } from '@/lib/razorpay';

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-razorpay-signature') || '';

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const eventId = payload.event_id || payload.id || `${payload.event}_${Date.now()}`;
    const event = payload.event;

    // Idempotency: Reject duplicate webhook event delivery
    if (eventId && store.hasWebhookEvent(eventId)) {
      store.logSystem('INFO', 'WEBHOOK', `Duplicate webhook event ${eventId} safely ignored.`);
      return NextResponse.json({ status: 'ignored_duplicate', event_id: eventId });
    }

    // Resolve order and payment entities
    const paymentEntity = payload.payload?.payment?.entity;
    const orderEntity = payload.payload?.order?.entity;
    const orderId = paymentEntity?.order_id || orderEntity?.id;
    const paymentId = paymentEntity?.id;
    const amountPaise: number = paymentEntity?.amount || 0;

    // Resolve organization ID from registered order or payload notes
    let organizationId = GITAM_ORG_ID;
    if (orderId) {
      const orderRecord = store.getPaymentOrder(orderId);
      if (orderRecord?.organization_id) {
        organizationId = orderRecord.organization_id;
      }
    }
    if (!organizationId && paymentEntity?.notes?.organization_id) {
      organizationId = paymentEntity.notes.organization_id;
    }

    // Webhook Signature Verification against organization's specific webhook secret
    const config = store.getPaymentConfig(organizationId);
    if (config?.webhook_secret && !config.webhook_secret.includes('placeholder')) {
      const isValid = verifyWebhookSignature(rawBody, signature, organizationId);
      if (!isValid) {
        store.logSystem(
          'CRITICAL',
          'WEBHOOK',
          `Tampered or invalid Razorpay webhook signature for org ${organizationId}`,
          { signature_header: signature ? signature.slice(0, 8) + '...' : 'none' }
        );
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
      }
    }

    // Record webhook event for persistent idempotency
    store.recordWebhookEvent(eventId, organizationId, event, payload);

    // Process payment events
    if (event === 'order.paid' || event === 'payment.captured') {
      if (!orderId || !paymentId) {
        return NextResponse.json({ status: 'ok_no_ids', event });
      }

      const payment = store.verifyPayment(orderId, paymentId, signature, organizationId);
      if (payment) {
        const job = store.getJob(payment.job_id);
        if (job) {
          store.updateJobStatus(job.id, 'QUEUED');
        }
        store.logSystem(
          'INFO',
          'WEBHOOK',
          `PAYMENT AUTHORIZED: Order ${orderId} verified. Amount: ₹${(amountPaise / 100).toFixed(2)}. Print authorized.`,
          { order_id: orderId, payment_id: paymentId, organization_id: organizationId }
        );
      }
    } else if (event === 'payment.failed') {
      if (orderId) {
        const payment = store.getPayments().find((p) => p.razorpay_order_id === orderId);
        if (payment) {
          payment.status = 'FAILED';
          const job = store.getJob(payment.job_id);
          if (job) store.updateJobStatus(job.id, 'FAILED', { error_message: 'Payment failed at gateway' });
        }
      }
    }

    return NextResponse.json({ status: 'ok', event, event_id: eventId });
  } catch (error) {
    store.logSystem('ERROR', 'WEBHOOK', `Webhook processing error: ${(error as Error).message}`);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
