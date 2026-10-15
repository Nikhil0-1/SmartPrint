import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { storageService } from '@/lib/storage';
import { permanentlyDeleteDocument } from '@/lib/fileSecurity';
import { supabaseAdmin } from '@/lib/supabase';
import { dbWriteSystemLog } from '@/lib/db';

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
    let purgedFilesCount = 0;
    let expiredSessionsCount = 0;
    let purgedJobsCount = 0;
    let dbExpiredCount = 0;

    // ─── 1. Clean up store completed-job orphan files ────────────────────────
    const completedJobs = store.getAllJobs().filter((j) => j.status === 'COMPLETED');
    for (const job of completedJobs) {
      const deleted = await permanentlyDeleteDocument(job.id);
      if (deleted) {
        purgedFilesCount += 1;
      }
    }

    // ─── 2. Cancel abandoned unpaid jobs (store) ────────────────────────────
    const abandonedThreshold = now - 30 * 60 * 1000;
    const unpaidJobs = store.getAllJobs().filter(
      (j) =>
        ['CREATED', 'UPLOAD_COMPLETE', 'PAYMENT_PENDING'].includes(j.status) &&
        new Date(j.created_at).getTime() < abandonedThreshold
    );

    for (const job of unpaidJobs) {
      await permanentlyDeleteDocument(job.id);
      store.updateJobStatus(job.id, 'EXPIRED' as any, { error_message: 'Abandoned session expired before payment.' });
      purgedJobsCount += 1;
    }

    // ─── 3. Cancel abandoned unpaid jobs (DB) ───────────────────────────────
    // Expire print_jobs stuck in pre-payment states for > 30 minutes
    const dbAbandonedCutoff = new Date(now - 30 * 60 * 1000).toISOString();
    const { data: dbAbandonedJobs, error: dbAbandonedErr } = await supabaseAdmin
      .from('print_jobs')
      .select('id, file_storage_path')
      .in('status', ['CREATED', 'UPLOAD_COMPLETE', 'PAYMENT_PENDING'])
      .lt('created_at', dbAbandonedCutoff);

    if (!dbAbandonedErr && dbAbandonedJobs) {
      for (const dbJob of dbAbandonedJobs) {
        // Delete cloud file if path known
        if (dbJob.file_storage_path) {
          await storageService.deleteTemporaryDocument(dbJob.file_storage_path).catch(() => null);
        }

        await supabaseAdmin
          .from('print_jobs')
          .update({
            status: 'CANCELLED',
            error_message: 'Abandoned session expired before payment',
          })
          .eq('id', dbJob.id);

        dbExpiredCount += 1;
      }
    }

    // ─── 4. Release expired kiosk worker leases ──────────────────────────────
    // Jobs stuck in DISPATCHED/ACKNOWLEDGED with expired leases go back to QUEUED for retry
    const { data: staleLeasedJobs } = await supabaseAdmin
      .from('print_jobs')
      .select('id, retry_count, max_retries')
      .in('status', ['DISPATCHED', 'ACKNOWLEDGED'])
      .lt('lease_expires_at', new Date().toISOString());

    if (staleLeasedJobs) {
      for (const leaseJob of staleLeasedJobs) {
        if (leaseJob.retry_count >= leaseJob.max_retries) {
          await supabaseAdmin
            .from('print_jobs')
            .update({
              status: 'RECOVERY_REQUIRED',
              error_message: `Max retries (${leaseJob.max_retries}) exceeded after lease expiry`,
            })
            .eq('id', leaseJob.id);
        } else {
          // Reclaim — reset to QUEUED for the next worker
          await supabaseAdmin
            .from('print_jobs')
            .update({
              status: 'QUEUED',
              worker_lease_id: null,
              lease_expires_at: null,
            })
            .eq('id', leaseJob.id);
        }
      }
    }

    // ─── 5. Mark kiosks offline if heartbeat is stale ────────────────────────
    const heartbeatCutoff = new Date(now - 3 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from('kiosks')
      .update({ status: 'OFFLINE', updated_at: new Date().toISOString() })
      .lt('last_heartbeat', heartbeatCutoff)
      .neq('status', 'MAINTENANCE')
      .neq('status', 'DISABLED');

    // ─── 6. Batch purge expired storage objects via storage abstraction ───────
    const storagePurgeResult = await storageService.deleteExpiredDocuments(900); // older than 15 min

    // ─── 7. Audit log ─────────────────────────────────────────────────────────
    await dbWriteSystemLog({
      level: 'INFO',
      component: 'CLEANUP',
      message: 'Automated Zero-Retention cleanup cycle completed.',
      metadata: {
        purged_completed_files: purgedFilesCount,
        expired_abandoned_store_jobs: purgedJobsCount,
        expired_abandoned_db_jobs: dbExpiredCount,
        storage_objects_purged: storagePurgeResult.count,
        stale_leased_jobs_reset: staleLeasedJobs?.length || 0,
      },
    });

    store.logSystem('INFO', 'CLEANUP', 'Automated Zero-Retention cleanup cycle completed.', {
      purged_completed_files: purgedFilesCount,
      expired_abandoned_jobs: purgedJobsCount,
      storage_objects_purged: storagePurgeResult.count,
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      purged_completed_files: purgedFilesCount,
      expired_unpaid_jobs_store: purgedJobsCount,
      expired_unpaid_jobs_db: dbExpiredCount,
      stale_leases_reset: staleLeasedJobs?.length || 0,
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
