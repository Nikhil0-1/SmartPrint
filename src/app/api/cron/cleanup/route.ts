import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { storageService } from '@/lib/storage';
import { permanentlyDeleteDocument } from '@/lib/fileSecurity';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;
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

    // 1. Clean up completed print jobs whose files still exist
    const completedJobs = store.getAllJobs().filter((j) => j.status === 'COMPLETED');
    for (const job of completedJobs) {
      const deleted = await permanentlyDeleteDocument(job.id);
      if (deleted) {
        purgedFilesCount += 1;
      }
    }

    // 2. Clean up abandoned unpaid jobs older than 30 minutes
    const abandonedThreshold = now - 30 * 60 * 1000;
    const unpaidJobs = store.getAllJobs().filter(
      (j) =>
        ['CREATED', 'UPLOAD_COMPLETE', 'PAYMENT_PENDING'].includes(j.status) &&
        new Date(j.created_at).getTime() < abandonedThreshold
    );

    for (const job of unpaidJobs) {
      await permanentlyDeleteDocument(job.id);
      store.updateJobStatus(job.id, 'EXPIRED', { error_message: 'Abandoned session expired before payment.' });
      purgedJobsCount += 1;
    }

    // 3. Clean up failed or unresolved jobs past recovery ceiling (24 hours)
    const recoveryCeiling = now - 24 * 60 * 60 * 1000;
    const staleFailedJobs = store.getAllJobs().filter(
      (j) =>
        ['FAILED', 'RECOVERY_REQUIRED', 'CANCELLED'].includes(j.status) &&
        new Date(j.created_at).getTime() < recoveryCeiling
    );

    for (const job of staleFailedJobs) {
      await permanentlyDeleteDocument(job.id);
    }

    // 4. Batch purge expired storage objects via storage abstraction
    const storagePurgeResult = await storageService.deleteExpiredDocuments(900); // older than 15 mins

    store.logSystem('INFO', 'CLEANUP', 'Automated Zero-Retention cleanup cycle completed.', {
      purged_completed_files: purgedFilesCount,
      expired_abandoned_jobs: purgedJobsCount,
      storage_objects_purged: storagePurgeResult.count,
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      purged_completed_files: purgedFilesCount,
      expired_unpaid_jobs: purgedJobsCount,
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
