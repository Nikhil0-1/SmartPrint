import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { validateAndExtractPages, saveTemporaryDocumentMultiTenant } from '@/lib/fileSecurity';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const kioskId = formData.get('kiosk_id') as string | null;
    const sessionId = (formData.get('session_id') as string) || undefined;
    let organizationId = (formData.get('organization_id') as string) || undefined;

    if (!file) {
      return NextResponse.json({ error: 'No document file provided' }, { status: 400 });
    }

    if (!kioskId) {
      return NextResponse.json({ error: 'Kiosk ID is required' }, { status: 400 });
    }

    // Resolve organization from Kiosk if not directly supplied
    const kiosk = store.getKiosk(kioskId);
    if (kiosk?.organization_id) {
      organizationId = kiosk.organization_id;
    }
    if (!organizationId) {
      organizationId = GITAM_ORG_ID;
    }

    const pricing = store.getPricing(organizationId);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Validate file format and extract page count
    const validation = await validateAndExtractPages(
      buffer,
      file.type,
      file.name,
      pricing.max_file_size_mb
    );

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const pageCount = validation.pageCount || 1;
    if (pageCount > pricing.max_pages) {
      return NextResponse.json(
        { error: `Document has ${pageCount} pages, exceeding the maximum allowed limit of ${pricing.max_pages} pages.` },
        { status: 400 }
      );
    }

    // 2. Generate safe, high-entropy Job ID
    const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const jobId = `SP-${nowStr}-${randomSuffix}`;
    const idempotencyKey = `idemp_${jobId}_${Date.now()}`;

    // 2b. Concurrency Control: Support one active customer print workflow per physical kiosk
    const reservation = store.reserveKioskForJob(kioskId, jobId);
    if (!reservation.success) {
      return NextResponse.json({ error: reservation.error }, { status: 409 });
    }

    // 3. Calculate initial price in paise (default 1 copy, B&W)
    const ratePaise = pricing.bw_price_paise || Math.round(pricing.bw_price_per_page * 100);
    const initialPaise = pageCount * 1 * ratePaise;
    const initialAmountRupees = initialPaise / 100;

    // 4. Save to temporary private storage using canonical multi-tenant path
    const uploadResult = await saveTemporaryDocumentMultiTenant(
      organizationId,
      sessionId || 'sess_default',
      jobId,
      buffer,
      file.type,
      file.name
    );

    // 5. Register in database store with paise precision & tenant binding
    store.registerFile(
      jobId,
      file.name,
      file.type,
      file.size,
      pageCount,
      uploadResult.objectKey,
      organizationId
    );

    const job = store.createJob({
      id: jobId,
      organization_id: organizationId,
      session_id: sessionId,
      kiosk_id: kioskId,
      pages_total: pageCount,
      pages_selected: 'All',
      copies: 1,
      is_color: false,
      is_duplex: false,
      orientation: 'portrait',
      paper_size: 'A4',
      calculated_amount: initialAmountRupees,
      amount_paise: initialPaise,
      idempotency_key: idempotencyKey,
      original_filename: file.name,
      storage_object_key: uploadResult.objectKey,
    });

    // Advance state to UPLOAD_COMPLETE
    store.updateJobStatus(jobId, 'UPLOAD_COMPLETE');

    return NextResponse.json({
      success: true,
      job_id: job.id,
      job: {
        id: job.id,
        organization_id: job.organization_id,
        pages_total: job.pages_total,
        calculated_amount: job.calculated_amount,
        amount_paise: job.amount_paise,
        original_filename: file.name,
        kiosk_id: job.kiosk_id,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
