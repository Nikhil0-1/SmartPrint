import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { validateAndExtractPages, saveTemporaryDocument } from '@/lib/fileSecurity';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const kioskId = formData.get('kiosk_id') as string | null;
    const sessionId = (formData.get('session_id') as string) || undefined;

    if (!file) {
      return NextResponse.json({ error: 'No document file provided' }, { status: 400 });
    }

    if (!kioskId) {
      return NextResponse.json({ error: 'Kiosk ID is required' }, { status: 400 });
    }

    const pricing = store.getPricing();
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
        { error: `Document has ${pageCount} pages, exceeding the maximum limit of ${pricing.max_pages} pages.` },
        { status: 400 }
      );
    }

    // 2. Generate safe IDs
    const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const jobId = `SP-${nowStr}-${randomSuffix}`;
    const idempotencyKey = `idemp_${jobId}_${Date.now()}`;

    // 3. Calculate initial price (default 1 copy, B&W)
    const initialAmount = pageCount * 1 * pricing.bw_price_per_page + pricing.service_charge;

    // 4. Save to temporary secure memory/private storage
    saveTemporaryDocument(jobId, buffer, file.type, file.name);

    // 5. Register in database store
    store.registerFile(
      jobId,
      file.name,
      file.type,
      file.size,
      pageCount,
      `temporary-print-files/${jobId}/document.pdf`
    );

    const job = store.createJob({
      id: jobId,
      session_id: sessionId,
      kiosk_id: kioskId,
      pages_total: pageCount,
      pages_selected: 'All',
      copies: 1,
      is_color: false,
      is_duplex: false,
      orientation: 'portrait',
      paper_size: 'A4',
      calculated_amount: initialAmount,
      idempotency_key: idempotencyKey,
      original_filename: file.name,
    });

    // Advance to UPLOAD_COMPLETE
    store.updateJobStatus(jobId, 'UPLOAD_COMPLETE');

    return NextResponse.json({
      success: true,
      job: {
        id: job.id,
        pages_total: job.pages_total,
        calculated_amount: job.calculated_amount,
        original_filename: file.name,
        kiosk_id: job.kiosk_id,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
