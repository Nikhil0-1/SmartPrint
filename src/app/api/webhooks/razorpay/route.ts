import { NextResponse } from 'next/server';
import { GITAM_ORG_ID, store } from '@/lib/store';
import { verifyWebhookSignatureFromDb } from '@/lib/razorpay';
import {
  dbHasWebhookEvent,
  dbRecordWebhookEvent,
  dbGetPaymentOrder,
  dbUpdatePrintJobStatus,
  dbGetPrintJob,
  dbEnqueuePrintJob,
  dbWriteSystemLog,
  dbRecordPaymentTransaction,
} from '@/lib/db';

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-razorpay-signature') || '';

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const eventId =
      (payload.event_id as string) ||
      (payload.id as string) ||
      `${payload.event}_${Date.now()}`;
    const event = payload.event as string;

    // Idempotency: check in-memory store AND persistent DB
    const isDuplicate = store.hasWebhookEvent(eventId) || (await dbHasWebhookEvent(eventId));
    if (isDuplicate) {
      await dbWriteSystemLog({
        level: 'INFO',
        component: 'WEBHOOK',
        message: `Duplicate webhook event ${eventId} safely ignored.`,
      });
      return NextResponse.json({ status: 'ignored_duplicate', event_id: eventId });
    }

    // Resolve order and payment entities
    const payloadObj = payload.payload as Record<string, unknown> | undefined;
    const paymentEntity = (payloadObj?.payment as Record<string, unknown>)?.entity as
      | Record<string, unknown>
      | undefined;
    const orderEntity = (payloadObj?.order as Record<string, unknown>)?.entity as
      | Record<string, unknown>
      | undefined;
    const orderId = (paymentEntity?.order_id as string) || (orderEntity?.id as string);
    const paymentId = paymentEntity?.id as string | undefined;
    const amountPaise: number = (paymentEntity?.amount as number) || 0;

    // Resolve organization ID from registered order in the database
    let organizationId = GITAM_ORG_ID;
    if (orderId) {
      const orderRecord = await dbGetPaymentOrder(orderId);
      if (orderRecord?.organization_id) {
        organizationId = orderRecord.organization_id as string;
      }
    }
    const notes = paymentEntity?.notes as Record<string, string> | undefined;
    if (!organizationId && notes?.organization_id) {
      organizationId = notes.organization_id;
    }

    // Webhook Signature Verification using the organization's webhook secret from DB
    const isValid = await verifyWebhookSignatureFromDb(rawBody, signature, organizationId);
    if (!isValid) {
      await dbWriteSystemLog({
        level: 'CRITICAL',
        component: 'WEBHOOK',
        message: `Tampered or invalid Razorpay webhook signature for org ${organizationId}`,
        metadata: { signature_header: signature ? signature.slice(0, 8) + '...' : 'none' },
      });
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
    }

    // Record webhook event for persistent idempotency
    store.recordWebhookEvent(eventId, organizationId, event, payload);
    await dbRecordWebhookEvent(eventId, organizationId, event, payload);

    // Process payment events
    if (event === 'order.paid' || event === 'payment.captured') {
      if (!orderId || !paymentId) {
        return NextResponse.json({ status: 'ok_no_ids', event });
      }

      // Lookup order record to find the associated job
      const orderRecord = await dbGetPaymentOrder(orderId);
      if (orderRecord) {
        const jobId = orderRecord.job_id as string;

        // Record the payment transaction
        await dbRecordPaymentTransaction({
          job_id: jobId,
          organization_id: organizationId,
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          amount_paise: amountPaise,
          raw_payload: payload,
        });

        // Transition print job to QUEUED in FIFO order so it can be picked up by the Pi agent
        const job = await dbGetPrintJob(jobId);
        if (job) {
          await dbEnqueuePrintJob(jobId, job.printer_id || undefined);
        }

        await dbWriteSystemLog({
          level: 'INFO',
          component: 'WEBHOOK',
          message: `PAYMENT AUTHORIZED: Order ${orderId} verified. Amount: ₹${(amountPaise / 100).toFixed(2)}. Print authorized.`,
          metadata: {
            order_id: orderId,
            payment_id: paymentId,
            organization_id: organizationId,
          },
        });
      }
    } else if (event === 'payment.failed') {
      if (orderId) {
        const orderRecord = await dbGetPaymentOrder(orderId);
        if (orderRecord) {
          const jobId = orderRecord.job_id as string;
          const currentJob = await dbGetPrintJob(jobId);
          // Never overwrite an already verified, queued, printing, or completed job
          const protectedStatuses = ['PAYMENT_VERIFIED', 'QUEUED', 'DISPATCHED', 'PRINTING', 'COMPLETED'];
          if (currentJob && !protectedStatuses.includes(currentJob.status)) {
            await dbUpdatePrintJobStatus(jobId, 'PAYMENT_FAILED', 'Payment failed at gateway');
            store.updateJobStatus(jobId, 'FAILED', { error_message: 'Payment failed at gateway' });
          }
        }
      }
    }

    return NextResponse.json({ status: 'ok', event, event_id: eventId });
  } catch (error) {
    console.error('[WEBHOOK ERROR]:', error);
    await dbWriteSystemLog({
      level: 'ERROR',
      component: 'WEBHOOK',
      message: `Webhook processing error: ${(error as Error).message}`,
    });
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
