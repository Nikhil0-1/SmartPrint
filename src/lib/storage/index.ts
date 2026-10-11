/**
 * GITAM SMARTPRINT - STORAGE SERVICE ABSTRACTION
 *
 * Implements a unified storage abstraction layer designed to use Supabase Storage
 * today while remaining architecturally decoupled for a seamless future migration
 * to Cloudflare R2 or other S3-compatible providers without application rewrites.
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const TEMPORARY_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'smartprint-temporary';

export interface TemporaryUploadParams {
  organizationId: string;
  sessionId: string;
  documentId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface TemporaryUploadResult {
  bucket: string;
  objectKey: string;
  sizeBytes: number;
  mimeType: string;
  storageProvider: 'SUPABASE_STORAGE' | 'LOCAL_SECURE_BUFFER';
}

export interface IStorageService {
  /**
   * Uploads a temporary, private customer document
   */
  uploadTemporaryDocument(params: TemporaryUploadParams): Promise<TemporaryUploadResult>;

  /**
   * Retrieves temporary document bytes for authorized print pipeline consumption
   */
  getTemporaryDocument(objectKey: string): Promise<Buffer | null>;

  /**
   * Creates a time-limited signed URL for authorized kiosk download
   */
  createTemporaryDownloadAccess(objectKey: string, expiresInSeconds?: number): Promise<string | null>;

  /**
   * Permanently and securely destroys a temporary customer document
   */
  deleteTemporaryDocument(objectKey: string): Promise<boolean>;

  /**
   * Batch deletes expired or abandoned documents across the storage bucket
   */
  deleteExpiredDocuments(maxAgeSeconds?: number): Promise<{ count: number; deletedKeys: string[] }>;
}

// In-Memory secure fallback buffer for resilient local test execution
// Guarantees zero downtime if Supabase Storage credentials are not yet configured
const inMemorySecureSpool = new Map<
  string,
  { buffer: Buffer; mimeType: string; filename: string; uploadedAt: number }
>();

/**
 * Concrete Supabase Storage Adapter
 */
export class SupabaseStorageService implements IStorageService {
  private bucket: string;

  constructor(bucket: string = TEMPORARY_STORAGE_BUCKET) {
    this.bucket = bucket;
  }

  /**
   * Builds canonical object key: {organizationId}/{sessionId}/{documentId}_{cleanFilename}
   */
  public buildObjectKey(organizationId: string, sessionId: string, documentId: string, filename: string): string {
    const cleanName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${organizationId}/${sessionId}/${documentId}_${cleanName}`;
  }

  async uploadTemporaryDocument(params: TemporaryUploadParams): Promise<TemporaryUploadResult> {
    const objectKey = this.buildObjectKey(
      params.organizationId,
      params.sessionId,
      params.documentId,
      params.filename
    );

    // Always maintain in-memory spool for immediate local Raspberry Pi / CUPS execution
    inMemorySecureSpool.set(objectKey, {
      buffer: params.buffer,
      mimeType: params.mimeType,
      filename: params.filename,
      uploadedAt: Date.now(),
    });

    if (isSupabaseConfigured()) {
      try {
        const { error } = await supabaseAdmin.storage
          .from(this.bucket)
          .upload(objectKey, params.buffer, {
            contentType: params.mimeType,
            upsert: true,
          });

        if (error) {
          console.warn(`[STORAGE WARNING] Supabase Storage upload error: ${error.message}. Fallback to local secure buffer.`);
          return {
            bucket: this.bucket,
            objectKey,
            sizeBytes: params.buffer.length,
            mimeType: params.mimeType,
            storageProvider: 'LOCAL_SECURE_BUFFER',
          };
        }

        return {
          bucket: this.bucket,
          objectKey,
          sizeBytes: params.buffer.length,
          mimeType: params.mimeType,
          storageProvider: 'SUPABASE_STORAGE',
        };
      } catch (err) {
        console.warn(`[STORAGE ERROR] Supabase connection error: ${(err as Error).message}`);
      }
    }

    return {
      bucket: this.bucket,
      objectKey,
      sizeBytes: params.buffer.length,
      mimeType: params.mimeType,
      storageProvider: 'LOCAL_SECURE_BUFFER',
    };
  }

  async getTemporaryDocument(objectKey: string): Promise<Buffer | null> {
    // 1. Check local secure buffer first
    const local = inMemorySecureSpool.get(objectKey);
    if (local) {
      return local.buffer;
    }

    // 2. Retrieve from Supabase Storage
    if (isSupabaseConfigured()) {
      try {
        const { data, error } = await supabaseAdmin.storage.from(this.bucket).download(objectKey);
        if (!error && data) {
          const arrayBuffer = await data.arrayBuffer();
          return Buffer.from(arrayBuffer);
        }
      } catch (err) {
        console.error(`[STORAGE ERROR] Failed to download object ${objectKey}:`, err);
      }
    }

    return null;
  }

  async createTemporaryDownloadAccess(objectKey: string, expiresInSeconds: number = 300): Promise<string | null> {
    if (isSupabaseConfigured()) {
      try {
        const { data, error } = await supabaseAdmin.storage
          .from(this.bucket)
          .createSignedUrl(objectKey, expiresInSeconds);

        if (!error && data?.signedUrl) {
          return data.signedUrl;
        }
      } catch (err) {
        console.error(`[STORAGE ERROR] Failed to create signed download URL for ${objectKey}:`, err);
      }
    }

    // Fallback: Internal backend authenticated download endpoint
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return `${appUrl}/api/kiosk/download/object?key=${encodeURIComponent(objectKey)}`;
  }

  async deleteTemporaryDocument(objectKey: string): Promise<boolean> {
    let deletedLocal = false;
    let deletedRemote = false;

    // 1. Zero out and wipe local memory buffer
    const local = inMemorySecureSpool.get(objectKey);
    if (local) {
      local.buffer.fill(0); // Zeroize sensitive memory bytes
      inMemorySecureSpool.delete(objectKey);
      deletedLocal = true;
    }

    // 2. Delete from Supabase Storage private bucket
    if (isSupabaseConfigured()) {
      try {
        const { error } = await supabaseAdmin.storage.from(this.bucket).remove([objectKey]);
        if (!error) {
          deletedRemote = true;
        } else {
          console.warn(`[STORAGE WARNING] Failed to remove object ${objectKey} from Supabase:`, error.message);
        }
      } catch (err) {
        console.warn(`[STORAGE ERROR] Exception removing object ${objectKey}:`, err);
      }
    } else {
      deletedRemote = true;
    }

    return deletedLocal || deletedRemote;
  }

  async deleteExpiredDocuments(maxAgeSeconds: number = 900): Promise<{ count: number; deletedKeys: string[] }> {
    const now = Date.now();
    const threshold = now - maxAgeSeconds * 1000;
    const deletedKeys: string[] = [];

    // Purge local spool
    for (const [key, item] of inMemorySecureSpool.entries()) {
      if (item.uploadedAt < threshold) {
        item.buffer.fill(0);
        inMemorySecureSpool.delete(key);
        deletedKeys.push(key);
      }
    }

    // Purge Supabase Storage objects older than expiration
    if (isSupabaseConfigured()) {
      try {
        const { data: files, error } = await supabaseAdmin.storage.from(this.bucket).list();
        if (!error && files) {
          const toRemove: string[] = [];
          for (const file of files) {
            const createdAt = new Date(file.created_at || Date.now()).getTime();
            if (createdAt < threshold) {
              toRemove.push(file.name);
            }
          }
          if (toRemove.length > 0) {
            await supabaseAdmin.storage.from(this.bucket).remove(toRemove);
            deletedKeys.push(...toRemove);
          }
        }
      } catch (err) {
        console.error('[STORAGE CLEANUP ERROR]:', err);
      }
    }

    return {
      count: deletedKeys.length,
      deletedKeys,
    };
  }
}

// Global Singleton Export
export const storageService = new SupabaseStorageService();
