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

    // Token verification (idempotency key serves as one-time download authorization)
    if (token && token !== job.idempotency_key) {
      return new NextResponse('Unauthorized access token', { status: 403 });
    }

    // Check if document was already completed/deleted
    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      return new NextResponse('Document has already been purged', { status: 410 });
    }

    const doc = getTemporaryDocument(jobId);
    if (!doc) {
      return new NextResponse('Temporary document unavailable or deleted', { status: 404 });
    }

    return new NextResponse(new Uint8Array(doc.buffer), {
      status: 200,
      headers: {
        'Content-Type': doc.mimeType,
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
