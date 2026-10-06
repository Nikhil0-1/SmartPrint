import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { createRazorpayOrderMock, getRazorpayKeyId } from '@/lib/razorpay';

export async function POST(request: Request) {
  try {
    const { job_id } = await request.json();

    if (!job_id) {
      return NextResponse.json({ error: 'job_id is required' }, { status: 400 });
    }

    const job = store.getJob(job_id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status !== 'UPLOAD_COMPLETE') {
      return NextResponse.json(
        { error: `Job is in status '${job.status}' and cannot receive payment.` },
        { status: 400 }
      );
    }

    // Create Razorpay Order
    const order = createRazorpayOrderMock(job.calculated_amount, job.id);
    store.createPayment(job.id, order.id, job.calculated_amount, 'INR');

    return NextResponse.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      amount_rupees: job.calculated_amount,
      currency: 'INR',
      key_id: getRazorpayKeyId(),
      job_id: job.id,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
