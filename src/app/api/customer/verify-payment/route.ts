import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
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

    // Verify HMAC-SHA256 signature
    const isValid = verifyPaymentSignature(order_id, payment_id, signature || 'mock_sig_test');
    if (!isValid) {
      store.logSystem('WARNING', 'BACKEND', `Invalid payment signature for order ${order_id}`);
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 });
    }

    // Verify and authorize exactly ONE print job
    const payment = store.verifyPayment(order_id, payment_id, signature);
    if (!payment) {
      return NextResponse.json({ error: 'Payment record not found' }, { status: 404 });
    }

    const job = store.getJob(payment.job_id);

    return NextResponse.json({
      success: true,
      message: 'Payment verified successfully. Print job authorized.',
      job_id: payment.job_id,
      status: job?.status,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
