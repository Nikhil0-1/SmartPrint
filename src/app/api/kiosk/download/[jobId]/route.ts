import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { getTemporaryDocument } from '@/lib/fileSecurity';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    const job = store.getJob(jobId);
    if (!job) {
      return new NextResponse('Job not found or document expired', { status: 404 });
    }

    // Token or Device Header authorization check
    const deviceTokenHeader = request.headers.get('x-device-token');
    const kioskIdHeader = request.headers.get('x-kiosk-id');

    let authorized = false;
    if (token && token === job.idempotency_key) {
      authorized = true;
    } else if (kioskIdHeader && kioskIdHeader === job.kiosk_id) {
      const kiosk = store.getKiosk(job.kiosk_id);
      if (kiosk && deviceTokenHeader === kiosk.device_token_hash) {
        authorized = true;
      }
    } else if (!token && process.env.NODE_ENV !== 'production') {
      authorized = true;
    }

    if (!authorized) {
      return new NextResponse('Unauthorized device or token for this print job', { status: 403 });
    }

    // Check if document was already completed/deleted
    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      return new NextResponse('Document has already been purged', { status: 410 });
    }

    const docBuffer = await getTemporaryDocument(jobId);
    if (!docBuffer) {
      return new NextResponse('Temporary document unavailable or deleted', { status: 404 });
    }

    const mimeType = job.original_filename?.endsWith('.png')
      ? 'image/png'
      : job.original_filename?.endsWith('.jpg') || job.original_filename?.endsWith('.jpeg')
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
