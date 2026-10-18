import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { validateAndExtractPages, saveTemporaryDocumentMultiTenant } from '@/lib/fileSecurity';
import { dbGetKiosk, dbGetPricing, dbCreatePrintJob } from '@/lib/db';

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('file') as File[];
    const kioskId = formData.get('kiosk_id') as string | null;
    const sessionId = (formData.get('session_id') as string) || undefined;
    let organizationId = (formData.get('organization_id') as string) || undefined;
    if (!files || files.length === 0) return NextResponse.json({ error: 'No document files provided' }, { status: 400 });

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

    

    // Process each file, create jobs, and aggregate amounts
    const createdJobs: any[] = [];
    let totalPaise = 0;
    for (const file of files) {
      // Size guard per file
      if (file.size > (pricing?.max_file_size_mb ?? 40) * 1024 * 1024) {
        return NextResponse.json({ error: `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the limit.` }, { status: 400 });
      }
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const validation = await validateAndExtractPages(buffer, file.type, file.name, pricing?.max_file_size_mb ?? 40);
      if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 400 });
      const pageCount = validation.pageCount || 1;
      if (pageCount > (pricing?.max_pages ?? 100)) {
        return NextResponse.json({ error: `Document has ${pageCount} pages, exceeding the limit.` }, { status: 400 });
      }
      const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const jobId = `SP-${nowStr}-${randomSuffix}`;
      const idempotencyKey = `idemp_${jobId}_${Date.now()}`;
      const reservation = store.reserveKioskForJob(kioskId, jobId);
      if (!reservation.success) return NextResponse.json({ error: reservation.error }, { status: 409 });
      const bwPricePaise = pricing?.bw_price_paise || Math.round((pricing?.bw_price_per_page ?? 2.5) * 100);
      const jobPaise = pageCount * bwPricePaise;
      totalPaise += jobPaise;
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
        calculated_amount: jobPaise / 100,
        amount_paise: jobPaise,
        idempotency_key: idempotencyKey,
        document_name: file.name,
        file_storage_path: uploadResult.objectKey,
        status: 'UPLOAD_COMPLETE',
      });
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
        calculated_amount: jobPaise / 100,
        amount_paise: jobPaise,
        idempotency_key: idempotencyKey,
        original_filename: file.name,
        storage_object_key: uploadResult.objectKey,
      });
      store.updateJobStatus(jobId, 'UPLOAD_COMPLETE');
      createdJobs.push({ jobId, fileName: file.name, pages: pageCount, amount_rupees: jobPaise / 100, storage_provider: uploadResult.storageProvider });
    }

    const totalAmountRupees = totalPaise / 100;
    return NextResponse.json({
      success: true,
      jobs: createdJobs,
      total_amount: totalAmountRupees,
      total_amount_paise: totalPaise,
    });


  } catch (error) {
    console.error('[UPLOAD ERROR]:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}