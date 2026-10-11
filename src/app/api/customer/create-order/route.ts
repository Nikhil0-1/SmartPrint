import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { createMultiTenantRazorpayOrder, getPublicRazorpayKeyId } from '@/lib/razorpay';

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

    if (job.status !== 'UPLOAD_COMPLETE' && job.status !== 'VALIDATING') {
      return NextResponse.json(
        { error: `Job is in status '${job.status}' and cannot receive payment.` },
        { status: 400 }
      );
    }

    const organizationId = job.organization_id || GITAM_ORG_ID;

    // SERVER-SIDE PRINTER ROUTING SAFETY CHECK
    // Verify printer availability before accepting payment
    const printerCheck = store.selectPrinterForJob(job.kiosk_id, job.is_color, job.is_duplex);
    if (!printerCheck.success || !printerCheck.printer) {
      return NextResponse.json(
        {
          error: printerCheck.error_message || 'The required printer is currently unavailable.',
          code: 'PRINTER_UNAVAILABLE',
        },
        { status: 503 }
      );
    }

    // Assign chosen printer to job
    job.printer_id = printerCheck.printer.id;

    const amountPaise = job.amount_paise || Math.round(job.calculated_amount * 100);

    // Create Order with organization's configured Razorpay credentials
    const order = await createMultiTenantRazorpayOrder(
      organizationId,
      amountPaise,
      job.id,
      {
        kiosk_id: job.kiosk_id,
        printer_id: printerCheck.printer.id,
      }
    );

    // Register payment order in ledger
    store.createPaymentOrder({
      id: `po_${order.id}`,
      organization_id: organizationId,
      job_id: job.id,
      razorpay_order_id: order.id,
      amount_paise: amountPaise,
      currency: 'INR',
      status: 'CREATED',
      created_at: new Date().toISOString(),
    });

    store.createPayment(job.id, order.id, job.calculated_amount, 'INR', organizationId);
    store.updateJobStatus(job.id, 'PAYMENT_PENDING');

    return NextResponse.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      amount_rupees: job.calculated_amount,
      amount_paise: amountPaise,
      currency: 'INR',
      key_id: getPublicRazorpayKeyId(organizationId),
      job_id: job.id,
      organization_id: organizationId,
      printer_assigned: printerCheck.printer.display_name,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
