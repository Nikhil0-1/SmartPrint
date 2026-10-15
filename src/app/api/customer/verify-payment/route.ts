import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import {
  dbGetPaymentOrder,
  dbRecordPaymentTransaction,
  dbGetPrintJob,
  dbCreatePrintJob,
  dbEnqueuePrintJob,
  dbGetJobQueuePosition,
  dbWriteSystemLog,
} from '@/lib/db';
import { verifyPaymentSignature } from '@/lib/razorpay';

export async function POST(request: Request) {
  try {
    let order_id: string | undefined, payment_id: string | undefined,
      signature: string | undefined, job_id: string | undefined;
    try {
      const body = await request.json();
      order_id = body?.order_id;
      payment_id = body?.payment_id;
      signature = body?.signature;
      job_id = body?.job_id;
    } catch {
      return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });
    }

    if (!order_id || !payment_id) {
      return NextResponse.json(
        { error: 'order_id and payment_id are required' },
        { status: 400 }
      );
    }

    // 1. Resolve payment order from DB, fallback to store
    const dbOrder = await dbGetPaymentOrder(order_id);
    const storeOrder = store.getPaymentOrder(order_id);
    const orgId: string = (dbOrder?.organization_id as string) || storeOrder?.organization_id || GITAM_ORG_ID;
    const amountPaise: number = Number(dbOrder?.amount_paise) || storeOrder?.amount_paise || 100;
    const effectiveJobId = (dbOrder?.job_id as string) || storeOrder?.job_id || job_id;
    if (!effectiveJobId) {
      return NextResponse.json({ error: 'Job ID not associated with order and not provided in request' }, { status: 400 });
    }

    // 2. Verify HMAC-SHA256 signature using the organization's configured secret
    const isValid = await verifyPaymentSignature(order_id, payment_id, signature || 'mock_sig_test', orgId);
    if (!isValid) {
      await dbWriteSystemLog({
        level: 'WARNING',
        component: 'PAYMENT',
        job_id: effectiveJobId,
        message: `Invalid payment signature for order ${order_id} [Org: ${orgId}]`,
      });
      store.logSystem('WARNING', 'BACKEND', `Invalid payment signature for order ${order_id} [Org: ${orgId}]`);
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 });
    }

    // 3. Persist verified payment transaction idempotently
    await dbRecordPaymentTransaction({
      job_id: effectiveJobId,
      organization_id: orgId,
      razorpay_order_id: order_id,
      razorpay_payment_id: payment_id,
      amount_paise: amountPaise,
      currency: 'INR',
      raw_payload: { order_id, payment_id, signature },
    });

    // Also mirror to store
    store.verifyPayment(order_id, payment_id, signature || 'mock_sig', orgId, effectiveJobId);

    // 4. Ensure job exists and transition to QUEUED in authoritative database
    let dbJob = await dbGetPrintJob(effectiveJobId);
    if (!dbJob && effectiveJobId) {
      dbJob = await dbCreatePrintJob({
        id: effectiveJobId,
        organization_id: orgId,
        session_id: 'recovered_session',
        kiosk_id: 'GITAM-SPK-001',
        pages_total: 1,
        pages_selected: 'All',
        copies: 1,
        is_color: false,
        is_duplex: false,
        calculated_amount: amountPaise / 100,
        amount_paise: amountPaise,
        status: 'PAYMENT_VERIFIED',
      });
    }

    // Atomically enqueue print job into the physical printer's FIFO queue
    const queuedJob = await dbEnqueuePrintJob(effectiveJobId, dbJob?.printer_id || undefined);
    store.updateJobStatus(effectiveJobId, 'QUEUED');

    // 5. Get deterministic queue position for customer feedback
    const queueInfo = await dbGetJobQueuePosition(effectiveJobId);

    return NextResponse.json({
      success: true,
      message: 'Payment verified successfully. Print job authorized and queued in FIFO order.',
      job_id: effectiveJobId,
      customer_access_token: queuedJob?.customer_access_token || dbJob?.customer_access_token || null,
      status: 'QUEUED',
      status_label: queueInfo?.status_label || 'Your document has been added to the print queue',
      queue_position: queueInfo?.queue_position || 1,
      jobs_ahead: queueInfo?.jobs_ahead || 0,
      printer_name: queueInfo?.printer_name || 'Assigned Printer',
      estimated_wait_seconds: queueInfo?.estimated_wait_seconds || 0,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
