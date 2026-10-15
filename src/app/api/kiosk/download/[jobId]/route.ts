import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { dbGetPrintJob, dbGetKiosk } from '@/lib/db';
import { getTemporaryDocument } from '@/lib/fileSecurity';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    // 1. Authoritative DB job lookup with store fallback
    const dbJob = await dbGetPrintJob(jobId);
    const storeJob = store.getJob(jobId);

    const job = dbJob || storeJob;
    if (!job) {
      return new NextResponse('Job not found or document expired', { status: 404 });
    }

    // 2. Reject immediately if document was already purged (HTTP 410 Gone)
    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      return new NextResponse('Document has already been purged', { status: 410 });
    }

    // 3. Token or Device Header authorization
    const deviceTokenHeader = request.headers.get('x-device-token');
    const kioskIdHeader = request.headers.get('x-kiosk-id');

    let authorized = false;

    // Token must match the job's idempotency_key
    if (token && token === job.idempotency_key) {
      authorized = true;
    } else if (kioskIdHeader && kioskIdHeader === job.kiosk_id) {
      // Validate device token against DB kiosk record first, then store fallback
      const dbKiosk = await dbGetKiosk(job.kiosk_id);
      if (dbKiosk && deviceTokenHeader) {
        // Compare against hashed token stored in DB
        authorized = deviceTokenHeader === dbKiosk.device_token_hash;
      }

      if (!authorized) {
        const storeKiosk = store.getKiosk(job.kiosk_id);
        if (storeKiosk && deviceTokenHeader === storeKiosk.device_token_hash) {
          authorized = true;
        }
      }
    } else if (!token && process.env.NODE_ENV !== 'production') {
      authorized = true;
    }

    if (!authorized) {
      return new NextResponse('Unauthorized device or token for this print job', { status: 403 });
    }

    const docBuffer = await getTemporaryDocument(jobId);
    if (!docBuffer) {
      return new NextResponse('Temporary document unavailable or deleted', { status: 404 });
    }

    const filename = ('document_name' in job && job.document_name)
      ? (job.document_name as string)
      : ('original_filename' in job && (job as unknown as Record<string, unknown>).original_filename)
      ? String((job as unknown as Record<string, unknown>).original_filename)
      : 'document.pdf';

    const mimeType = filename.endsWith('.png')
      ? 'image/png'
      : filename.endsWith('.jpg') || filename.endsWith('.jpeg')
      ? 'image/jpeg'
      : 'application/pdf';

    return new NextResponse(new Uint8Array(docBuffer), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="smartprint_${jobId}.pdf"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  } catch (error) {
    return new NextResponse((error as Error).message, { status: 500 });
  }
}
