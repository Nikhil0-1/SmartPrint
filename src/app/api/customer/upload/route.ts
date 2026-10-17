import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { validateAndExtractPages, saveTemporaryDocumentMultiTenant } from '@/lib/fileSecurity';
import { dbGetKiosk, dbGetPricing, dbCreatePrintJob } from '@/lib/db';

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const kioskId = formData.get('kiosk_id') as string | null;
    const sessionId = (formData.get('session_id') as string) || undefined;
    let organizationId = (formData.get('organization_id') as string) || undefined;

    if (!file) return NextResponse.json({ error: 'No document file provided' }, { status: 400 });
    if (!kioskId) return NextResponse.json({ error: 'Kiosk ID is required' }, { status: 400 });

    // Resolve org from DB (authoritative), fall back to in-memory store
    const [dbKiosk, dbPricingForOrg] = await Promise.all([
      dbGetKiosk(kioskId),
      organizationId ? dbGetPricing(organizationId) : Promise.resolve(null),
    ]);

    if (dbKiosk?.organization_id) {
      organizationId = dbKiosk.organization_id as string;
    } else {
      const storeKiosk = store.getKiosk(kioskId);
      if (storeKiosk?.organization_id) organizationId = storeKiosk.organization_id;
    }
    if (!organizationId) organizationId = GITAM_ORG_ID;

    // Get pricing: prefer DB row, fallback in-memory store
    const dbPricing = dbPricingForOrg || (await dbGetPricing(organizationId));
    const pricing = dbPricing || store.getPricing(organizationId);
    const maxFileSizeMb = pricing?.max_file_size_mb ?? 40;
    const maxPages = pricing?.max_pages ?? 100;

    // EARLY size guard - reject before reading file into memory
    if (file.size > maxFileSizeMb * 1024 * 1024) {
      return NextResponse.json(
        { error: `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the ${maxFileSizeMb} MB limit.` },
        { status: 400 }
      );
    }

    // Read file once into buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate format and extract page count
    const validation = await validateAndExtractPages(buffer, file.type, file.name, maxFileSizeMb);
    if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 400 });

    const pageCount = validation.pageCount || 1;
    if (pageCount > maxPages) {
      return NextResponse.json(
        { error: `Document has ${pageCount} pages, exceeding the ${maxPages}-page limit.` },
        { status: 400 }
      );
    }

    // Generate Job ID
    const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const jobId = `SP-${nowStr}-${randomSuffix}`;
    const idempotencyKey = `idemp_${jobId}_${Date.now()}`;

    // Kiosk concurrency control
    const reservation = store.reserveKioskForJob(kioskId, jobId);
    if (!reservation.success) return NextResponse.json({ error: reservation.error }, { status: 409 });

    // Calculate price in paise
    const bwPricePaise =
      pricing?.bw_price_paise ||
      Math.round((pricing?.bw_price_per_page ?? 2.5) * 100);
    const initialPaise = pageCount * bwPricePaise;
    const initialAmountRupees = initialPaise / 100;

    // Upload to storage and persist job in DB with storage path
    const uploadResult = await saveTemporaryDocumentMultiTenant(
      organizationId,
      sessionId || 'sess_default',
      jobId,
      buffer,
      file.type,
      file.name
    );

    const dbJob = await dbCreatePrintJob({
      id: jobId,
      organization_id: organizationId,
      session_id: sessionId || null,
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
      document_name: file.name,
      file_storage_path: uploadResult.objectKey,
      status: 'UPLOAD_COMPLETE',
    });

    // Register in in-memory store for local fallback
    store.registerFile(jobId, file.name, file.type, file.size, pageCount, uploadResult.objectKey, organizationId);
    store.createJob({
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
    store.updateJobStatus(jobId, 'UPLOAD_COMPLETE');
    void dbJob;

    return NextResponse.json({
      success: true,
      job_id: jobId,
      storage_provider: uploadResult.storageProvider,
      job: {
        id: jobId,
        organization_id: organizationId,
        pages_total: pageCount,
        calculated_amount: initialAmountRupees,
        amount_paise: initialPaise,
        original_filename: file.name,
        kiosk_id: kioskId,
      },
    });
  } catch (error) {
    console.error('[UPLOAD ERROR]:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}