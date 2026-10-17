import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { dbGetPrintJob, dbUpdatePrintJobStatus, dbWriteSystemLog } from '@/lib/db';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { authenticateDeviceRequest, validateJobScope } from '@/lib/deviceAuth';
import { isValidCompletionPrecondition } from '@/lib/jobLifecycle';
import { permanentlyDeleteDocument } from '@/lib/fileSecurity';
import { PrintJobStatus } from '@/lib/types';

export async function POST(request: Request) {
  try {
    // 1. Authoritative Device Authentication
    const auth = await authenticateDeviceRequest(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });
    }

    const { job_id, cups_job_id } = body || {};

    if (!job_id) {
      return NextResponse.json({ error: 'job_id is required' }, { status: 400 });
    }

    // 2. Fetch Authoritative Job Record
    let job = await dbGetPrintJob(job_id);
    if (!job && !isSupabaseConfigured()) {
      job = store.getJob(job_id) as any;
    }

    if (!job) {
      return NextResponse.json({ error: `Job not found: ${job_id}` }, { status: 404 });
    }

    // 3. Confirm job belongs to the authenticated kiosk and organization
    const scopeCheck = validateJobScope(job, auth.kiosk);
    if (!scopeCheck.authorized) {
      return NextResponse.json({ error: scopeCheck.error }, { status: scopeCheck.status || 403 });
    }

    // 4. Idempotency Check: if already COMPLETED, succeed immediately without re-purging or failing
    if (job.status === 'COMPLETED') {
      return NextResponse.json({
        success: true,
        job_id,
        status: 'COMPLETED',
        cleanup_verified: true,
        already_completed: true,
        timestamp: new Date().toISOString(),
      });
    }

    // 5. Precondition Check: Prevent unauthorized jump to COMPLETED from non-print states
    const currentStatus = job.status as PrintJobStatus;
    if (!isValidCompletionPrecondition(currentStatus)) {
      return NextResponse.json(
        { error: `Cannot complete job in status '${currentStatus}'. Active print state required.` },
        { status: 400 }
      );
    }

    // 6. Concurrently perform DB state transition, kiosk release, and verified file deletion
    const [deleted] = await Promise.all([
      permanentlyDeleteDocument(job_id, job),
      dbUpdatePrintJobStatus(job_id, 'COMPLETED', undefined, cups_job_id),
      isSupabaseConfigured()
        ? supabaseAdmin
            .from('kiosks')
            .update({ active_job_id: null, updated_at: new Date().toISOString() })
            .eq('id', auth.kiosk.id)
        : Promise.resolve(),
    ]);

    // 7. Transition store job to COMPLETED & release kiosk active job
    store.updateJobStatus(job_id, 'COMPLETED', { cups_job_id });
    store.releaseKioskJob(auth.kiosk.id, job_id);

    // 9. Log verified completion
    await dbWriteSystemLog({
      level: 'INFO',
      component: 'CLEANUP',
      kiosk_id: auth.kiosk.id,
      job_id,
      message: `COMPLETE_CYCLE: Job ${job_id} successfully printed and verified deleted.`,
      metadata: {
        cups_job_id,
        document_deleted: deleted,
      },
    });

    store.logSystem('INFO', 'CLEANUP', `COMPLETE_CYCLE: Job ${job_id} successfully printed and verified deleted.`, {
      cups_job_id,
      document_deleted: deleted,
    });

    return NextResponse.json({
      success: true,
      job_id,
      status: 'COMPLETED',
      cleanup_verified: deleted,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[JOB-COMPLETE ERROR]:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
