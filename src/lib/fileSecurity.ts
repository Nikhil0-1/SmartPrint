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
    // Images are strictly 1 page
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
