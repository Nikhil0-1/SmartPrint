import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { dbGetPrintJob } from '@/lib/db';
import { isSupabaseConfigured } from '@/lib/supabase';
import { authenticateDeviceRequest, validateJobScope } from '@/lib/deviceAuth';
import { getTemporaryDocument } from '@/lib/fileSecurity';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    // 1. Authoritative Device Authentication
    // Strictly requires X-Kiosk-Id and X-Device-Token headers.
    const auth = await authenticateDeviceRequest(request);
    if (!auth.authenticated) {
      return new NextResponse(auth.error, { status: auth.status });
    }

    const { jobId } = await params;
    if (!jobId) {
      return new NextResponse('Job ID is required', { status: 400 });
    }

    // 2. Fetch Authoritative Job Record
    let job = await dbGetPrintJob(jobId);
    if (!job && !isSupabaseConfigured()) {
      job = store.getJob(jobId) as any;
    }

    if (!job) {
      return new NextResponse('Job not found or document expired', { status: 404 });
    }

    // 3. Scope job to authenticated kiosk and organization
    const scopeCheck = validateJobScope(job, auth.kiosk);
    if (!scopeCheck.authorized) {
      return new NextResponse(scopeCheck.error || 'Forbidden', { status: scopeCheck.status || 403 });
    }

    // 4. Reject immediately if document was already purged (HTTP 410 Gone)
    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      return new NextResponse('Document has already been purged', { status: 410 });
    }

    // 5. Retrieve ephemeral file
    const docBuffer = await getTemporaryDocument(jobId);
    if (!docBuffer) {
      return new NextResponse('Temporary document unavailable or deleted', { status: 410 });
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
    console.error('[DOWNLOAD ERROR]:', error);
    return new NextResponse((error as Error).message, { status: 500 });
  }
}
