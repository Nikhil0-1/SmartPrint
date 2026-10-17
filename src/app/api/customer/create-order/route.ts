import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import {
  dbGetPrintJob,
  dbCreatePrintJob,
  dbSelectBestPrinterForJob,
  dbCreatePaymentOrder,
  dbUpdatePrintJobStatus,
} from '@/lib/db';
import { createMultiTenantRazorpayOrder, getPublicRazorpayKeyId } from '@/lib/razorpay';

export async function POST(request: Request) {
  try {
    let job_id: string | undefined;
    try {
      const body = await request.json();
      job_id = body?.job_id;
    } catch {
      return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });
    }

    if (!job_id) {
      return NextResponse.json({ error: 'job_id is required' }, { status: 400 });
    }

    // 1. Fetch from Database first, fallback to store
    let dbJob = await dbGetPrintJob(job_id);
    let storeJob = store.getJob(job_id);

    if (!dbJob && !storeJob) {
      // Recreate job record for serverless recovery
      dbJob = await dbCreatePrintJob({
        id: job_id,
        organization_id: GITAM_ORG_ID,
        session_id: 'recovered_session',
        kiosk_id: 'GITAM-SPK-001',
        pages_total: 1,
        pages_selected: 'All',
        copies: 1,
        is_color: false,
        is_duplex: false,
        calculated_amount: 1.0,
        amount_paise: 100,
        status: 'UPLOAD_COMPLETE',
      });

      storeJob = store.createJob({
        id: job_id,
        organization_id: GITAM_ORG_ID,
        session_id: 'recovered_session',
        kiosk_id: 'GITAM-SPK-001',
        pages_total: 1,
        pages_selected: 'All',
        copies: 1,
        is_color: false,
        is_duplex: false,
        calculated_amount: 1.0,
        amount_paise: 100,
        status: 'UPLOAD_COMPLETE',
      });
    }

    const currentStatus = dbJob?.status || storeJob?.status;
    if (
      currentStatus !== 'UPLOAD_COMPLETE' &&
      currentStatus !== 'VALIDATING' &&
      currentStatus !== 'PAYMENT_PENDING'
    ) {
      return NextResponse.json(
        { error: `Job is in status '${currentStatus}' and cannot receive payment.` },
        { status: 400 }
      );
    }

    const organizationId: string = (dbJob?.organization_id as string) || storeJob?.organization_id || GITAM_ORG_ID;
    const kioskId: string = (dbJob?.kiosk_id as string) || storeJob?.kiosk_id || 'GITAM-SPK-001';
    const isColor: boolean = dbJob?.is_color ?? storeJob?.is_color ?? false;
    const isDuplex: boolean = dbJob?.is_duplex ?? storeJob?.is_duplex ?? false;
    const calculatedAmount: number = Number(dbJob?.calculated_amount ?? storeJob?.calculated_amount ?? 1.0);
    const amountPaise: number =
      Number(dbJob?.amount_paise) ||
      storeJob?.amount_paise ||
      Math.round(calculatedAmount * 100);

    // 2. SERVER-SIDE PRINTER ROUTING SAFETY CHECK
    // Database authoritative printer selection
    const printerSelection = await dbSelectBestPrinterForJob(kioskId, isColor, isDuplex, organizationId);
    let selectedPrinter = printerSelection.printer;

    if (!selectedPrinter) {
      // Fallback to store printer selection
      const storePrinterCheck = store.selectPrinterForJob(kioskId, isColor, isDuplex);
      if (storePrinterCheck.printer) {
        selectedPrinter = storePrinterCheck.printer as any;
      }
    }

    if (!selectedPrinter) {
      return NextResponse.json(
        {
          error: printerSelection.error || 'The required printer is currently unavailable.',
          code: 'PRINTER_UNAVAILABLE',
        },
        { status: 503 }
      );
    }

    // 3. Create Razorpay order with organization's configured credentials
    const order = await createMultiTenantRazorpayOrder(
      organizationId,
      amountPaise,
      job_id,
      {
        kiosk_id: kioskId,
        printer_id: selectedPrinter.id,
      }
    );

    if (!order) {
      return NextResponse.json(
        {
          error:
            'Payment gateway error: Unable to initialize Razorpay order. Please ensure your Razorpay Key ID and Secret are configured and verified in Admin Settings.',
          code: 'PAYMENT_GATEWAY_NOT_READY',
        },
        { status: 502 }
      );
    }

    const orderId = (order as any).id as string;
    const orderAmount = (order as any).amount as number;

    // 4. Register payment order in authoritative database
    await dbCreatePaymentOrder({
      job_id,
      organization_id: organizationId,
      razorpay_order_id: orderId,
      amount_paise: amountPaise,
      currency: 'INR',
    });

    // Also mirror to store
    store.createPaymentOrder({
      id: `po_${orderId}`,
      organization_id: organizationId,
      job_id,
      razorpay_order_id: orderId,
      amount_paise: amountPaise,
      currency: 'INR',
      status: 'CREATED',
      created_at: new Date().toISOString(),
    });

    store.createPayment(job_id, orderId, calculatedAmount, 'INR', organizationId);
    await dbUpdatePrintJobStatus(job_id, 'PAYMENT_PENDING');
    store.updateJobStatus(job_id, 'PAYMENT_PENDING');

    return NextResponse.json({
      success: true,
      order_id: orderId,
      amount: orderAmount,
      amount_rupees: calculatedAmount,
      amount_paise: amountPaise,
      currency: 'INR',
      key_id: await getPublicRazorpayKeyId(organizationId),
      job_id,
      customer_access_token: dbJob?.customer_access_token || null,
      organization_id: organizationId,
      printer_assigned: selectedPrinter.display_name || selectedPrinter.printer_name,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
