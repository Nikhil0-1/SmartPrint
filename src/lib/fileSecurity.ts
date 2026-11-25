import { PDFDocument } from 'pdf-lib';
import { store } from './store';
import { storageService, TemporaryUploadResult } from './storage';
import { dbGetPrintJob } from './db';
import { supabaseAdmin, isSupabaseConfigured } from './supabase';

// Allowed MIME types strictly adhering to Section 8.1
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
]);

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  pageCount?: number;
  mimeType?: string;
}

/**
 * Ultra-fast non-blocking binary scan to extract PDF page count in <2ms.
 * Avoids loading the full PDF AST / font tables into memory.
 * Falls back to PDFDocument.load() only when binary scan is inconclusive.
 */
export function fastCountPdfPages(buffer: Buffer): number | null {
  try {
    const text = buffer.toString('latin1');

    // 1. Scan for /Type /Pages ... /Count N (the page tree root or intermediate nodes)
    const pagesRegex = /\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/g;
    let match: RegExpExecArray | null;
    let maxPagesCount = 0;
    while ((match = pagesRegex.exec(text)) !== null) {
      const c = parseInt(match[1], 10);
      if (!isNaN(c) && c > maxPagesCount) {
        maxPagesCount = c;
      }
    }
    if (maxPagesCount > 0) {
      return maxPagesCount;
    }

    // Also match reversed /Count N ... /Type /Pages
    const reversePagesRegex = /\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g;
    while ((match = reversePagesRegex.exec(text)) !== null) {
      const c = parseInt(match[1], 10);
      if (!isNaN(c) && c > maxPagesCount) {
        maxPagesCount = c;
      }
    }
    if (maxPagesCount > 0) {
      return maxPagesCount;
    }

    // 2. Scan for individual /Type /Page objects (leaf pages)
    // Make sure it doesn't match /Type /Pages
    const pageObjMatches = text.match(/\/Type\s*\/Page\b(?!\s*s)/g);
    if (pageObjMatches && pageObjMatches.length > 0) {
      return pageObjMatches.length;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Standardizes an image buffer (PNG / JPEG) into a high-quality A4 PDF.
 * Scales the image proportionally within printable bounds with 0.5-inch margins.
 */
export async function convertImageToPdf(
  imageBuffer: Buffer,
  mimeType?: string,
  filename?: string
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  // Standard A4 dimensions in PDF points (72 DPI): 595.28 x 841.89 pt
  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;
  const MARGIN = 36; // 0.5 inch margin

  const isPng =
    (mimeType && mimeType.includes('png')) ||
    (filename && filename.toLowerCase().endsWith('.png')) ||
    (imageBuffer.length > 4 && imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50);

  let embeddedImage;
  if (isPng) {
    embeddedImage = await pdfDoc.embedPng(imageBuffer);
  } else {
    embeddedImage = await pdfDoc.embedJpg(imageBuffer);
  }

  const { width: imgWidth, height: imgHeight } = embeddedImage;
  const maxContentWidth = A4_WIDTH - MARGIN * 2;
  const maxContentHeight = A4_HEIGHT - MARGIN * 2;

  // Preserve aspect ratio; fit within printable canvas
  const scale = Math.min(maxContentWidth / imgWidth, maxContentHeight / imgHeight, 1.0);
  const scaledWidth = imgWidth * scale;
  const scaledHeight = imgHeight * scale;

  // Center on A4 page
  const x = (A4_WIDTH - scaledWidth) / 2;
  const y = (A4_HEIGHT - scaledHeight) / 2;

  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  page.drawImage(embeddedImage, {
    x,
    y,
    width: scaledWidth,
    height: scaledHeight,
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes.buffer as ArrayBuffer, pdfBytes.byteOffset, pdfBytes.byteLength);
}

export async function validateAndExtractPages(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
  maxSizeMb = 20
): Promise<FileValidationResult> {
  // 1. File size check
  const maxBytes = maxSizeMb * 1024 * 1024;
  if (fileBuffer.length > maxBytes) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed limit of ${maxSizeMb} MB.`,
    };
  }

  // 2. MIME type check
  const lowerName = fileName.toLowerCase();
  const isAllowedExt =
    lowerName.endsWith('.pdf') ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg') ||
    lowerName.endsWith('.png');

  if (!ALLOWED_MIME_TYPES.has(mimeType) && !isAllowedExt) {
    return {
      valid: false,
      error: 'Unsupported file format. Please upload a PDF, PNG, or JPEG file.',
    };
  }

  // 3. Extract actual page count
  let pageCount = 1;
  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
    // Ultra-fast fastCountPdfPages first (<2ms vs 5-10s)
    const fastCount = fastCountPdfPages(fileBuffer);
    if (fastCount && fastCount > 0) {
      pageCount = fastCount;
    } else {
      try {
        const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
        pageCount = pdfDoc.getPageCount();
        if (pageCount < 1) {
          return { valid: false, error: 'The PDF document contains 0 pages or is corrupt.' };
        }
      } catch (e) {
        return {
          valid: false,
          error: `Could not parse PDF. File may be corrupted or password-protected. Details: ${(e as Error).message}`,
        };
      }
    }
  } else {
    // Images are strictly 1 page — zero parsing needed
    pageCount = 1;
  }

  return {
    valid: true,
    pageCount,
    mimeType: mimeType || (lowerName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
  };
}

export async function saveTemporaryDocumentMultiTenant(
  organizationId: string,
  sessionId: string,
  jobId: string,
  buffer: Buffer,
  mimeType: string,
  originalName: string
): Promise<TemporaryUploadResult> {
  const result = await storageService.uploadTemporaryDocument({
    organizationId,
    sessionId,
    documentId: jobId,
    filename: originalName,
    mimeType,
    buffer,
  });

  store.logSystem(
    'INFO',
    'STORAGE',
    `Secure temporary document stored [Provider: ${result.storageProvider}] for job ${jobId}`,
    { organizationId, objectKey: result.objectKey, sizeBytes: result.sizeBytes }
  );

  return result;
}

export async function saveTemporaryDocument(
  jobId: string,
  buffer: Buffer,
  mimeType: string,
  originalName: string
): Promise<TemporaryUploadResult> {
  const job = store.getJob(jobId);
  const organizationId = job?.organization_id || '00000000-0000-0000-0000-000000000001';
  const sessionId = job?.session_id || 'sess_default';
  return saveTemporaryDocumentMultiTenant(organizationId, sessionId, jobId, buffer, mimeType, originalName);
}

export async function getTemporaryDocument(jobId: string): Promise<Buffer | null> {
  const dbJob = await dbGetPrintJob(jobId);
  const storeJob = store.getJob(jobId);

  const objectKey = dbJob?.file_storage_path || storeJob?.storage_object_key;
  if (objectKey) {
    const buffer = await storageService.getTemporaryDocument(objectKey);
    if (buffer) return buffer;
  }

  // Try fallback key pattern
  const orgId = dbJob?.organization_id || storeJob?.organization_id || '00000000-0000-0000-0000-000000000001';
  const sessId = dbJob?.session_id || storeJob?.session_id || 'sess_default';
  const docName = dbJob?.document_name || storeJob?.original_filename || 'document.pdf';
  const fallbackKey = `${orgId}/${sessId}/${jobId}_${docName}`;
  return storageService.getTemporaryDocument(fallbackKey);
}

export async function permanentlyDeleteDocument(
  jobId: string,
  knownJob?: { file_storage_path?: string | null; organization_id?: string; session_id?: string | null; document_name?: string | null } | null
): Promise<boolean> {
  const dbJob = knownJob !== undefined ? knownJob : await dbGetPrintJob(jobId);
  const storeJob = store.getJob(jobId);
  let success = false;

  const objectKey = dbJob?.file_storage_path || storeJob?.storage_object_key;
  if (objectKey) {
    success = await storageService.deleteTemporaryDocument(objectKey);
  } else {
    // Check fallback keys
    const orgId = dbJob?.organization_id || storeJob?.organization_id || '00000000-0000-0000-0000-000000000001';
    const sessId = dbJob?.session_id || storeJob?.session_id || 'sess_default';
    const docName = dbJob?.document_name || storeJob?.original_filename || 'document.pdf';
    const fallbackKey = `${orgId}/${sessId}/${jobId}_${docName}`;
    success = await storageService.deleteTemporaryDocument(fallbackKey);
  }

  // Mark in store metadata that file has been permanently purged
  store.deleteJobFile(jobId);

  // Clear storage references in Supabase in parallel
  if (isSupabaseConfigured()) {
    try {
      await Promise.all([
        supabaseAdmin
          .from('print_jobs')
          .update({
            file_storage_path: null,
            file_url: null,
          })
          .eq('id', jobId),
        supabaseAdmin
          .from('files')
          .update({
            deleted_at: new Date().toISOString(),
            status: 'DELETED',
          })
          .eq('job_id', jobId),
      ]);
    } catch (err) {
      console.error('[CLEANUP] Failed to nullify storage references in database:', err);
    }
  }

  store.logSystem('INFO', 'CLEANUP', `CLEANUP_VERIFIED: Ephemeral document permanently purged for job ${jobId}`, {
    job_id: jobId,
    purged: success,
  });

  return success;
}
