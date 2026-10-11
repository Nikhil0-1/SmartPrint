import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { verifyPaymentSignature } from '@/lib/razorpay';

export async function POST(request: Request) {
  try {
    const { order_id, payment_id, signature } = await request.json();

    if (!order_id || !payment_id) {
      return NextResponse.json(
        { error: 'order_id and payment_id are required' },
        { status: 400 }
      );
    }

    // Resolve payment order from store
    const paymentOrder = store.getPaymentOrder(order_id);
    const orgId = paymentOrder?.organization_id || GITAM_ORG_ID;

    // Verify HMAC-SHA256 signature using the organization's configured secret
    const isValid = verifyPaymentSignature(order_id, payment_id, signature || 'mock_sig_test', orgId);
    if (!isValid) {
      store.logSystem('WARNING', 'BACKEND', `Invalid payment signature for order ${order_id} [Org: ${orgId}]`);
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 });
    }

    // Verify and authorize exactly ONE print job
    const payment = store.verifyPayment(order_id, payment_id, signature, orgId);
    if (!payment) {
      return NextResponse.json({ error: 'Payment record not found or tenant mismatch' }, { status: 404 });
    }

    const job = store.getJob(payment.job_id);
    if (job) {
      // Transition to QUEUED
      store.updateJobStatus(job.id, 'QUEUED');
    }

    return NextResponse.json({
      success: true,
      message: 'Payment verified successfully. Print job authorized.',
      job_id: payment.job_id,
      status: job?.status || 'QUEUED',
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
