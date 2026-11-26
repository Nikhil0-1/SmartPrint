import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { dbGetPrintJob } from '@/lib/db';
import { isSupabaseConfigured } from '@/lib/supabase';
import { authenticateDeviceRequest, validateJobScope } from '@/lib/deviceAuth';
import { getTemporaryDocument, convertImageToPdf } from '@/lib/fileSecurity';

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
    let docBuffer = await getTemporaryDocument(jobId);
    if (!docBuffer) {
      return new NextResponse('Temporary document unavailable or deleted', { status: 410 });
    }

    const filename = ('document_name' in job && job.document_name)
      ? (job.document_name as string)
      : ('original_filename' in job && (job as unknown as Record<string, unknown>).original_filename)
      ? String((job as unknown as Record<string, unknown>).original_filename)
      : 'document.pdf';

    // Always ensure PDF is served to the Pi. Never serve raw PNG/JPEG — Pi may be on old code.
    // For Office docs / WebP / BMP / TXT: serve with original extension so Pi converts via LibreOffice/Pillow.
    let mimeType = 'application/pdf';
    let downloadExt = 'pdf';
    if (docBuffer.length > 4) {
      const isPdf = docBuffer.subarray(0, 5).toString('ascii') === '%PDF-';
      const isPng = docBuffer[0] === 0x89 && docBuffer[1] === 0x50 && docBuffer[2] === 0x4e;
      const isJpg = docBuffer[0] === 0xff && docBuffer[1] === 0xd8;
      const isWebp = docBuffer.subarray(0, 4).toString('ascii') === 'RIFF' && docBuffer.subarray(8, 12).toString('ascii') === 'WEBP';
      const isBmp = docBuffer[0] === 0x42 && docBuffer[1] === 0x4d;
      const isGif = docBuffer.subarray(0, 6).toString('ascii').startsWith('GIF8');
      const isTiff = (docBuffer[0] === 0x49 && docBuffer[1] === 0x49) || (docBuffer[0] === 0x4d && docBuffer[1] === 0x4d);

      if (isPng || isJpg || isWebp || isBmp || isGif || isTiff) {
        // Always convert images to PDF — Pi must only receive PDF or Office docs
        try {
          const imgMime = isPng ? 'image/png' : isJpg ? 'image/jpeg' : isWebp ? 'image/webp' : isBmp ? 'image/bmp' : isGif ? 'image/gif' : 'image/tiff';
          const converted = await convertImageToPdf(docBuffer, imgMime, filename);
          docBuffer = Buffer.from(converted.buffer as ArrayBuffer, converted.byteOffset, converted.byteLength);
          mimeType = 'application/pdf';
          downloadExt = 'pdf';
        } catch (convErr) {
          // If conversion fails, return error — do NOT serve raw image to Pi
          console.error('[DOWNLOAD] CRITICAL: Image-to-PDF conversion failed, refusing to serve raw image:', convErr);
          return new NextResponse('Document processing failed: could not convert image to PDF for printing.', { status: 500 });
        }
      } else if (!isPdf) {
        // Office docs, RTF, TXT — serve with original extension so updated Pi converts via LibreOffice
        mimeType = 'application/octet-stream';
        const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/);
        if (extMatch) {
          downloadExt = extMatch[1].toLowerCase();
        }
      }
    }

    return new NextResponse(new Uint8Array(docBuffer), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="smartprint_${jobId}.${downloadExt}"`,
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
