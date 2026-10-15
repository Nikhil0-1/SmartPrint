import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { storageService } from '@/lib/storage';
import { permanentlyDeleteDocument } from '@/lib/fileSecurity';
import { supabaseAdmin } from '@/lib/supabase';
import { dbWriteSystemLog } from '@/lib/db';

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET || 'smartprint_cron_secret_2026';
    const adminSecret = process.env.ADMIN_SECRET_TOKEN;

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();

    const isAuthorized =
      (Boolean(cronSecret) && token === cronSecret) ||
      (Boolean(adminSecret) && token === adminSecret);

    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized cron caller' }, { status: 401 });
    }

    const now = Date.now();
    const abandonedThreshold = now - 30 * 60 * 1000;
    const dbAbandonedCutoff = new Date(abandonedThreshold).toISOString();
    const heartbeatCutoff = new Date(now - 3 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    // ─── Run Store & Cloud cleanups concurrently ────────────────────────────
    const completedJobs = store.getAllJobs().filter((j) => j.status === 'COMPLETED');
    const unpaidJobs = store.getAllJobs().filter(
      (j) =>
        ['CREATED', 'UPLOAD_COMPLETE', 'PAYMENT_PENDING'].includes(j.status) &&
        new Date(j.created_at).getTime() < abandonedThreshold
    );

    // Parallel execution of file purges, DB status updates, and storage sweeping
    const [
      completedPurges,
      unpaidPurges,
      dbAbandonedResult,
      leaseResetResult,
      kioskHeartbeatResult,
      storagePurgeResult,
    ] = await Promise.all([
      // 1. Purge store completed jobs
      Promise.all(completedJobs.map((j) => permanentlyDeleteDocument(j.id))),
      // 2. Cancel abandoned store jobs
      Promise.all(
        unpaidJobs.map(async (j) => {
          await permanentlyDeleteDocument(j.id);
          store.updateJobStatus(j.id, 'EXPIRED' as any, {
            error_message: 'Abandoned session expired before payment.',
          });
          return true;
        })
      ),
      // 3. Batch cancel abandoned DB jobs
      supabaseAdmin
        .from('print_jobs')
        .update({
          status: 'CANCELLED',
          error_message: 'Abandoned session expired before payment',
        })
        .in('status', ['CREATED', 'UPLOAD_COMPLETE', 'PAYMENT_PENDING'])
        .lt('created_at', dbAbandonedCutoff)
        .select('id, file_storage_path'),
      // 4. Batch reset stale leased jobs
      supabaseAdmin
        .from('print_jobs')
        .update({
          status: 'QUEUED',
          worker_lease_id: null,
          lease_expires_at: null,
        })
        .in('status', ['DISPATCHED', 'ACKNOWLEDGED'])
        .lt('lease_expires_at', nowIso)
        .select('id'),
      // 5. Mark stale kiosks offline
      supabaseAdmin
        .from('kiosks')
        .update({ status: 'OFFLINE', updated_at: nowIso })
        .lt('last_heartbeat', heartbeatCutoff)
        .neq('status', 'MAINTENANCE')
        .neq('status', 'DISABLED'),
      // 6. Storage sweep
      storageService.deleteExpiredDocuments(900),
    ]);

    const purgedFilesCount = completedPurges.filter(Boolean).length;
    const purgedJobsCount = unpaidPurges.length;
    const dbExpiredCount = dbAbandonedResult.data?.length || 0;
    const staleLeasesResetCount = leaseResetResult.data?.length || 0;

    // Clean any remote files associated with abandoned DB jobs
    if (dbAbandonedResult.data && dbAbandonedResult.data.length > 0) {
      Promise.all(
        dbAbandonedResult.data
          .filter((j) => j.file_storage_path)
          .map((j) => storageService.deleteTemporaryDocument(j.file_storage_path!))
      ).catch(() => null);
    }

    // ─── 7. Log asynchronously without blocking response ───────────────────
    void dbWriteSystemLog({
      level: 'INFO',
      component: 'CLEANUP',
      message: 'Automated Zero-Retention cleanup cycle completed.',
      metadata: {
        purged_completed_files: purgedFilesCount,
        expired_abandoned_store_jobs: purgedJobsCount,
        expired_abandoned_db_jobs: dbExpiredCount,
        storage_objects_purged: storagePurgeResult.count,
        stale_leased_jobs_reset: staleLeasesResetCount,
      },
    });

    store.logSystem('INFO', 'CLEANUP', 'Automated Zero-Retention cleanup cycle completed.', {
      purged_completed_files: purgedFilesCount,
      expired_abandoned_jobs: purgedJobsCount,
      storage_objects_purged: storagePurgeResult.count,
    });

    return NextResponse.json({
      success: true,
      timestamp: nowIso,
      purged_completed_files: purgedFilesCount,
      expired_unpaid_jobs_store: purgedJobsCount,
      expired_unpaid_jobs_db: dbExpiredCount,
      stale_leases_reset: staleLeasesResetCount,
      storage_objects_purged: storagePurgeResult.count,
      status: 'CLEANUP_SUCCESS',
    });
  } catch (error) {
    store.logSystem('ERROR', 'CLEANUP', `Cleanup worker failed: ${(error as Error).message}`);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
