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
    const body = await request.json();
    let jobIds: string[] = [];
    if (Array.isArray(body.job_ids) && body.job_ids.length > 0) {
      jobIds = body.job_ids.map((id: any) => String(id));
    } else if (body.job_id) {
      jobIds = [String(body.job_id)];
    } else {
      return NextResponse.json({ error: 'job_id or job_ids array is required' }, { status: 400 });
    }

    // Fetch all jobs (DB first, fallback to store)
    const jobsData: { id: string; dbJob: any; storeJob: any }[] = [];
    for (const id of jobIds) {
      let dbJob = await dbGetPrintJob(id);
      let storeJob = store.getJob(id);
      if (!dbJob && !storeJob) {
        // Recreate minimal job record for recovery (same as original logic)
        dbJob = await dbCreatePrintJob({
          id,
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
          id,
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
      jobsData.push({ id, dbJob, storeJob });
    }

    // Validate each job's status and aggregate total amount
    let totalAmountPaise = 0;
    let organizationId = '';
    let kioskId = '';
    let isColor = false;
    let isDuplex = false;
    for (const { id, dbJob, storeJob } of jobsData) {
      const currentStatus = dbJob?.status || storeJob?.status;
      if (currentStatus !== 'UPLOAD_COMPLETE' && currentStatus !== 'VALIDATING' && currentStatus !== 'PAYMENT_PENDING') {
        return NextResponse.json({ error: `Job ${id} is in status '${currentStatus}' and cannot receive payment.` }, { status: 400 });
      }
      if (!organizationId) organizationId = (dbJob?.organization_id as string) || storeJob?.organization_id || GITAM_ORG_ID;
      if (!kioskId) kioskId = (dbJob?.kiosk_id as string) || storeJob?.kiosk_id || 'GITAM-SPK-001';
      if (!isColor) isColor = dbJob?.is_color ?? storeJob?.is_color ?? false;
      if (!isDuplex) isDuplex = dbJob?.is_duplex ?? storeJob?.is_duplex ?? false;
      const amountPaise = Number(dbJob?.amount_paise) || storeJob?.amount_paise || Math.round(Number(dbJob?.calculated_amount ?? storeJob?.calculated_amount ?? 1.0) * 100);
      totalAmountPaise += amountPaise;
    }

    // Server‑side printer routing safety check (single printer for the whole batch)
    const printerSelection = await dbSelectBestPrinterForJob(kioskId, isColor, isDuplex, organizationId);
    let selectedPrinter = printerSelection.printer;
    if (!selectedPrinter) {
      const storePrinterCheck = store.selectPrinterForJob(kioskId, isColor, isDuplex);
      if (storePrinterCheck.printer) selectedPrinter = storePrinterCheck.printer as any;
    }
    if (!selectedPrinter) {
      return NextResponse.json({ error: printerSelection.error || 'The required printer is currently unavailable.', code: 'PRINTER_UNAVAILABLE' }, { status: 503 });
    }

    // Create a single Razorpay order for the combined amount
    const order = await createMultiTenantRazorpayOrder(
      organizationId,
      totalAmountPaise,
      jobIds[0], // reference first job for idempotency
      { kiosk_id: kioskId, printer_id: selectedPrinter.id }
    );
    if (!order) {
      return NextResponse.json({ error: 'Payment gateway error: Unable to initialize Razorpay order. Please ensure your Razorpay Key ID and Secret are configured and verified in Admin Settings.', code: 'PAYMENT_GATEWAY_NOT_READY' }, { status: 502 });
    }
    const orderId = (order as any).id as string;
    const orderAmount = (order as any).amount as number;

    // Register the payment order for each job in the batch
    for (const { id } of jobsData) {
      await dbCreatePaymentOrder({
        job_id: id,
        organization_id: organizationId,
        razorpay_order_id: orderId,
        amount_paise: totalAmountPaise,
        currency: 'INR',
      });
      store.createPaymentOrder({
        id: `po_${orderId}`,
        organization_id: organizationId,
        job_id: id,
        razorpay_order_id: orderId,
        amount_paise: totalAmountPaise,
        currency: 'INR',
        status: 'CREATED',
        created_at: new Date().toISOString(),
      });
      store.createPayment(id, orderId, totalAmountPaise / 100, 'INR', organizationId);
      await dbUpdatePrintJobStatus(id, 'PAYMENT_PENDING');
      store.updateJobStatus(id, 'PAYMENT_PENDING');
    }

    return NextResponse.json({
      success: true,
      order_id: orderId,
      amount: orderAmount,
      amount_rupees: totalAmountPaise / 100,
      amount_paise: totalAmountPaise,
      currency: 'INR',
      key_id: await getPublicRazorpayKeyId(organizationId),
      job_ids: jobIds,
      organization_id: organizationId,
      printer_assigned: selectedPrinter.display_name || selectedPrinter.printer_name,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// End of file - duplicate legacy block removed
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
    const body = await request.json();
    let jobIds: string[] = [];
    if (Array.isArray(body.job_ids) && body.job_ids.length > 0) {
      jobIds = body.job_ids.map((id: any) => String(id));
    } else if (body.job_id) {
      jobIds = [String(body.job_id)];
    } else {
      return NextResponse.json({ error: 'job_id or job_ids array is required' }, { status: 400 });
    }

    // Fetch all jobs (DB first, fallback to store)
    const jobsData: { id: string; dbJob: any; storeJob: any }[] = [];
    for (const id of jobIds) {
      let dbJob = await dbGetPrintJob(id);
      let storeJob = store.getJob(id);
      if (!dbJob && !storeJob) {
        // Recreate minimal job record for recovery (same as original logic)
        dbJob = await dbCreatePrintJob({
          id,
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
          id,
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
      jobsData.push({ id, dbJob, storeJob });
    }

    // Validate each job's status and aggregate total amount
    let totalAmountPaise = 0;
    let organizationId = '';
    let kioskId = '';
    let isColor = false;
    let isDuplex = false;
    for (const { id, dbJob, storeJob } of jobsData) {
      const currentStatus = dbJob?.status || storeJob?.status;
      if (currentStatus !== 'UPLOAD_COMPLETE' && currentStatus !== 'VALIDATING' && currentStatus !== 'PAYMENT_PENDING') {
        return NextResponse.json({ error: `Job ${id} is in status '${currentStatus}' and cannot receive payment.` }, { status: 400 });
      }
      if (!organizationId) organizationId = (dbJob?.organization_id as string) || storeJob?.organization_id || GITAM_ORG_ID;
      if (!kioskId) kioskId = (dbJob?.kiosk_id as string) || storeJob?.kiosk_id || 'GITAM-SPK-001';
      if (!isColor) isColor = dbJob?.is_color ?? storeJob?.is_color ?? false;
      if (!isDuplex) isDuplex = dbJob?.is_duplex ?? storeJob?.is_duplex ?? false;
      const amountPaise = Number(dbJob?.amount_paise) || storeJob?.amount_paise || Math.round(Number(dbJob?.calculated_amount ?? storeJob?.calculated_amount ?? 1.0) * 100);
      totalAmountPaise += amountPaise;
    }

    // Server‑side printer routing safety check (single printer for the whole batch)
    const printerSelection = await dbSelectBestPrinterForJob(kioskId, isColor, isDuplex, organizationId);
    let selectedPrinter = printerSelection.printer;
    if (!selectedPrinter) {
      const storePrinterCheck = store.selectPrinterForJob(kioskId, isColor, isDuplex);
      if (storePrinterCheck.printer) selectedPrinter = storePrinterCheck.printer as any;
    }
    if (!selectedPrinter) {
      return NextResponse.json({ error: printerSelection.error || 'The required printer is currently unavailable.', code: 'PRINTER_UNAVAILABLE' }, { status: 503 });
    }

    // Create a single Razorpay order for the combined amount
    const order = await createMultiTenantRazorpayOrder(
      organizationId,
      totalAmountPaise,
      jobIds[0], // reference first job for idempotency
      { kiosk_id: kioskId, printer_id: selectedPrinter.id }
    );
    if (!order) {
      return NextResponse.json({ error: 'Payment gateway error: Unable to initialize Razorpay order. Please ensure your Razorpay Key ID and Secret are configured and verified in Admin Settings.', code: 'PAYMENT_GATEWAY_NOT_READY' }, { status: 502 });
    }
    const orderId = (order as any).id as string;
    const orderAmount = (order as any).amount as number;

    // Register the payment order for each job in the batch
    for (const { id } of jobsData) {
      await dbCreatePaymentOrder({
        job_id: id,
        organization_id: organizationId,
        razorpay_order_id: orderId,
        amount_paise: totalAmountPaise,
        currency: 'INR',
      });
      store.createPaymentOrder({
        id: `po_${orderId}`,
        organization_id: organizationId,
        job_id: id,
        razorpay_order_id: orderId,
        amount_paise: totalAmountPaise,
        currency: 'INR',
        status: 'CREATED',
        created_at: new Date().toISOString(),
      });
      store.createPayment(id, orderId, totalAmountPaise / 100, 'INR', organizationId);
      await dbUpdatePrintJobStatus(id, 'PAYMENT_PENDING');
      store.updateJobStatus(id, 'PAYMENT_PENDING');
    }

    return NextResponse.json({
      success: true,
      order_id: orderId,
      amount: orderAmount,
      amount_rupees: totalAmountPaise / 100,
      amount_paise: totalAmountPaise,
      currency: 'INR',
      key_id: await getPublicRazorpayKeyId(organizationId),
      job_ids: jobIds,
      organization_id: organizationId,
      printer_assigned: selectedPrinter.display_name || selectedPrinter.printer_name,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

/*
import {
  dbGetPrintJob,
  dbCreatePrintJob,
  dbSelectBestPrinterForJob,
  dbCreatePaymentOrder,
  dbUpdatePrintJobStatus,
} from '@/lib/db';
import { createMultiTenantRazorpayOrder, getPublicRazorpayKeyId } from '@/lib/razorpay';

export async function POST_LEGACY(request: Request) {
  try {
    let jobIds: string[] = [];
    try {
      const body = await request.json();
      if (Array.isArray(body.job_ids) && body.job_ids.length > 0) {
        jobIds = body.job_ids.map((id: any) => String(id));
      } else if (body.job_id) {
        jobIds = [String(body.job_id)];
      } else {
        return NextResponse.json({ error: 'job_id or job_ids array is required' }, { status: 400 });
      }
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
