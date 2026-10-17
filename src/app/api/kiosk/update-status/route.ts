import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { dbGetPrintJob, dbUpdatePrintJobStatus, dbWriteSystemLog } from '@/lib/db';
import { isSupabaseConfigured } from '@/lib/supabase';
import { authenticateDeviceRequest, validateJobScope } from '@/lib/deviceAuth';
import { isValidStatusTransition, isValidCompletionPrecondition } from '@/lib/jobLifecycle';
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
      return NextResponse.json({ error: 'Invalid or missing JSON body' }, { status: 400 });
    }

    const { job_id, status, cups_job_id, error_message, recovery_reason } = body;

    if (!job_id || !status) {
      return NextResponse.json({ error: 'job_id and status are required' }, { status: 400 });
    }

    // 2. Fetch Authoritative Job Record
    let job = await dbGetPrintJob(job_id);
    if (!job && !isSupabaseConfigured()) {
      job = store.getJob(job_id) as any;
    }

    if (!job) {
      return NextResponse.json({ error: `Job not found: ${job_id}` }, { status: 404 });
    }

    // 3. Scope job to authenticated kiosk and organization
    const scopeCheck = validateJobScope(job, auth.kiosk);
    if (!scopeCheck.authorized) {
      return NextResponse.json({ error: scopeCheck.error }, { status: scopeCheck.status || 403 });
    }

    // 4. Validate allowed status transition
    const currentStatus = job.status as PrintJobStatus;
    const targetStatus = status as PrintJobStatus;

    if (!isValidStatusTransition(currentStatus, targetStatus)) {
      return NextResponse.json(
        { error: `Invalid status transition: cannot transition job from '${currentStatus}' to '${targetStatus}'` },
        { status: 400 }
      );
    }

    // 5. If transitioning to COMPLETED, verify completion precondition
    let cleanupVerified = false;
    if (targetStatus === 'COMPLETED') {
      if (!isValidCompletionPrecondition(currentStatus)) {
        return NextResponse.json(
          { error: `Cannot mark job COMPLETED from current status '${currentStatus}'. Active print state required.` },
          { status: 400 }
        );
      }
      cleanupVerified = await permanentlyDeleteDocument(job_id);
    }

    // 6. Update authoritative database record
    await dbUpdatePrintJobStatus(
      job_id,
      targetStatus,
      error_message || recovery_reason,
      cups_job_id
    );

    // Also update in-memory store for session synchronization
    const updatedStoreJob = store.updateJobStatus(job_id, targetStatus, {
      cups_job_id,
      error_message,
      recovery_reason,
    });

    if (targetStatus === 'COMPLETED' || targetStatus === 'FAILED' || targetStatus === 'OUTCOME_UNCERTAIN') {
      store.releaseKioskJob(auth.kiosk.id, job_id);
    }

    if (error_message || recovery_reason || targetStatus === 'RECOVERY_REQUIRED' || targetStatus === 'OUTCOME_UNCERTAIN') {
      await dbWriteSystemLog({
        level: 'WARNING',
        component: 'RASPBERRY_PI',
        kiosk_id: auth.kiosk.id,
        job_id,
        message: `Job ${job_id} transitioned to ${targetStatus}: ${error_message || recovery_reason || 'No error details'}`,
      });
    }

    return NextResponse.json({
      success: true,
      job_id,
      status: targetStatus,
      cleanup_verified: targetStatus === 'COMPLETED' ? cleanupVerified : undefined,
      job: updatedStoreJob || null,
    });
  } catch (error) {
    console.error('[UPDATE-STATUS ERROR]:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
