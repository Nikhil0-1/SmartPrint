import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import {
  dbGetPaymentOrder,
  dbGetPaymentOrders,
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
      signature: string | undefined, job_id: string | undefined, job_ids: string[] | undefined;
    try {
      const body = await request.json();
      order_id = body?.order_id;
      payment_id = body?.payment_id;
      signature = body?.signature;
      job_id = body?.job_id;
      if (Array.isArray(body?.job_ids)) {
        job_ids = body.job_ids.map((id: any) => String(id));
      }
    } catch {
      return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });
    }

    if (!order_id || !payment_id || !signature) {
      return NextResponse.json(
        { error: 'order_id, payment_id, and signature are required' },
        { status: 400 }
      );
    }

    // 1. Resolve payment order from DB, fallback to store
    const dbOrder = await dbGetPaymentOrder(order_id);
    const storeOrder = store.getPaymentOrder(order_id);
    const orgId: string = (dbOrder?.organization_id as string) || storeOrder?.organization_id || GITAM_ORG_ID;
    const amountPaise: number = Number(dbOrder?.amount_paise) || storeOrder?.amount_paise || 100;
    const effectiveJobId = (dbOrder?.job_id as string) || storeOrder?.job_id || job_id;

    // Gather all target jobs for this order (batch support)
    const dbOrders = await dbGetPaymentOrders(order_id);
    let targetJobIds: string[] = [];
    if (job_ids && job_ids.length > 0) {
      targetJobIds = job_ids;
    } else if (dbOrders.length > 0) {
      targetJobIds = Array.from(new Set(dbOrders.map(o => String(o.job_id)).filter(Boolean)));
    } else if (effectiveJobId) {
      targetJobIds = [effectiveJobId];
    }

    if (targetJobIds.length === 0) {
      return NextResponse.json({ error: 'Job ID not associated with order and not provided in request' }, { status: 400 });
    }

    // 2. Verify HMAC-SHA256 signature using the organization's configured secret
    const isValid = await verifyPaymentSignature(order_id, payment_id, signature, orgId);
    if (!isValid) {
      await dbWriteSystemLog({
        level: 'WARNING',
        component: 'PAYMENT',
        job_id: targetJobIds[0],
        message: `Invalid payment signature for order ${order_id} [Org: ${orgId}]`,
      });
      store.logSystem('WARNING', 'BACKEND', `Invalid payment signature for order ${order_id} [Org: ${orgId}]`);
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 });
    }

    // 3. Process each job in the batch
    let firstQueuedJob = null;
    let firstQueueInfo = null;

    for (const jId of targetJobIds) {
      await dbRecordPaymentTransaction({
        job_id: jId,
        organization_id: orgId,
        razorpay_order_id: order_id,
        razorpay_payment_id: payment_id,
        amount_paise: amountPaise,
        currency: 'INR',
        raw_payload: { order_id, payment_id, signature },
      });

      store.verifyPayment(order_id, payment_id, signature || 'mock_sig', orgId, jId);

      let dbJob = await dbGetPrintJob(jId);
      if (!dbJob && jId) {
        dbJob = await dbCreatePrintJob({
          id: jId,
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

      const queued = await dbEnqueuePrintJob(jId, dbJob?.printer_id || undefined);
      if (!firstQueuedJob) firstQueuedJob = queued || dbJob;

      store.updateJobStatus(jId, 'QUEUED');
      store.releaseKioskJob(dbJob?.kiosk_id || 'GITAM-SPK-001', jId);

      if (!firstQueueInfo) {
        firstQueueInfo = await dbGetJobQueuePosition(jId);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Payment verified successfully. Print jobs authorized and queued in FIFO order.',
      job_id: targetJobIds[0],
      job_ids: targetJobIds,
      customer_access_token: firstQueuedJob?.customer_access_token || null,
      status: 'QUEUED',
      status_label: firstQueueInfo?.status_label || 'Your document has been added to the print queue',
      queue_position: firstQueueInfo?.queue_position || 1,
      jobs_ahead: firstQueueInfo?.jobs_ahead || 0,
      printer_name: firstQueueInfo?.printer_name || 'Assigned Printer',
      estimated_wait_seconds: firstQueueInfo?.estimated_wait_seconds || 0,
    });
  } catch (error) {
    console.error('[VERIFY PAYMENT ERROR]:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
