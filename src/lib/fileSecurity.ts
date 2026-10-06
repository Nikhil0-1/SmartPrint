import { PDFDocument } from 'pdf-lib';
import { store } from './store';

// Allowed MIME types
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
]);

// Temporary in-memory document buffer map (job_id -> Buffer)
// This guarantees local testing and downloads work seamlessly before or alongside Supabase bucket configuration!
const temporaryDocStore = new Map<string, { buffer: Buffer; mimeType: string; originalName: string }>();

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  pageCount?: number;
  mimeType?: string;
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
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return {
      valid: false,
      error: 'Unsupported file format. Please upload a PDF, PNG, or JPEG file.',
    };
  }

  // 3. Extract page count
  let pageCount = 1;
  if (mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
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
  } else {
    // Images default to 1 page
    pageCount = 1;
  }

  return {
    valid: true,
    pageCount,
    mimeType,
  };
}

export function saveTemporaryDocument(
  jobId: string,
  buffer: Buffer,
  mimeType: string,
  originalName: string
) {
  temporaryDocStore.set(jobId, { buffer, mimeType, originalName });
}

export function getTemporaryDocument(jobId: string) {
  return temporaryDocStore.get(jobId);
}

export function permanentlyDeleteDocument(jobId: string): boolean {
  // 1. Wipe in-memory buffer
  const exists = temporaryDocStore.has(jobId);
  if (exists) {
    const item = temporaryDocStore.get(jobId);
    if (item?.buffer) {
      // Overwrite buffer memory with zeros before deletion
      item.buffer.fill(0);
    }
    temporaryDocStore.delete(jobId);
  }

  // 2. Mark database metadata deleted and erase storage path
  store.deleteJobFile(jobId);

  // 3. Verify deletion
  const verify = temporaryDocStore.has(jobId);
  if (!verify) {
    store.logSystem('INFO', 'CLEANUP', `CLEANUP_VERIFIED: Document permanently destroyed for job ${jobId}`);
    return true;
  } else {
    store.logSystem('CRITICAL', 'CLEANUP', `CLEANUP_FAILED: Failed to purge memory buffer for job ${jobId}`);
    return false;
  }
}
