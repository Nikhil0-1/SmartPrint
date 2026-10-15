import { NextResponse } from 'next/server';
import { dbGetPrintJobByToken, dbGetPrintJob, dbGetJobQueuePosition } from '@/lib/db';
import { store } from '@/lib/store';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    const jobId = searchParams.get('job_id');

    if (!token && !jobId) {
      return NextResponse.json(
        { error: 'Customer access token or job_id is required' },
        { status: 400 }
      );
    }

    // 1. First attempt secure privacy-preserving token lookup
    let job = token ? await dbGetPrintJobByToken(token) : null;

    // 2. Fallback to jobId if token matched or not provided
    if (!job && jobId) {
      const candidateJob = await dbGetPrintJob(jobId);
      // If job has an access token, enforce matching token
      if (candidateJob) {
        if (!candidateJob.customer_access_token || candidateJob.customer_access_token === token) {
          job = candidateJob;
        } else {
          return NextResponse.json(
            { error: 'Unauthorized: Invalid access token for this print job.' },
            { status: 403 }
          );
        }
      }
    }

    // 3. Fallback to store if DB is pending or job in store
    if (!job && jobId) {
      const storeJob = store.getJob(jobId);
      if (storeJob) {
        return NextResponse.json({
          success: true,
          job_id: storeJob.id,
          status: storeJob.status,
          status_label: getFriendlyStatusLabel(storeJob.status, 0),
          queue_position: 1,
          jobs_ahead: 0,
          printer_name: 'Campus Kiosk Printer',
          estimated_wait_seconds: 0,
          is_completed: storeJob.status === 'COMPLETED',
          is_failed: storeJob.status === 'FAILED' || storeJob.status === 'RECOVERY_REQUIRED',
          error_message: storeJob.error_message || null,
        });
      }
    }

    if (!job) {
      return NextResponse.json({ error: 'Print job not found' }, { status: 404 });
    }

    // 4. Calculate deterministic queue status
    const queueInfo = await dbGetJobQueuePosition(job.id);

    const isCompleted = job.status === 'COMPLETED';
    const isFailed =
      job.status === 'FAILED' ||
      job.status === 'RECOVERY_REQUIRED' ||
      job.status === 'CANCELLED' ||
      job.status === 'PAYMENT_FAILED';

    return NextResponse.json({
      success: true,
      job_id: job.id,
      status: job.status,
      status_label: queueInfo?.status_label || getFriendlyStatusLabel(job.status, queueInfo?.jobs_ahead || 0),
      queue_position: queueInfo?.queue_position || 1,
      jobs_ahead: queueInfo?.jobs_ahead || 0,
      printer_name: queueInfo?.printer_name || 'Assigned Printer',
      estimated_wait_seconds: queueInfo?.estimated_wait_seconds || 0,
      is_completed: isCompleted,
      is_failed: isFailed,
      error_message: job.error_message || null,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

function getFriendlyStatusLabel(status: string, jobsAhead: number): string {
  switch (status) {
    case 'CREATED':
    case 'PAYMENT_PENDING':
      return 'Waiting for payment confirmation';
    case 'PAYMENT_VERIFIED':
      return 'Payment verified';
    case 'QUEUED':
      return jobsAhead === 0 ? 'Your document is next in queue' : `Waiting for previous jobs to finish (${jobsAhead} ahead)`;
    case 'DISPATCHED':
    case 'ACKNOWLEDGED':
      return 'Printer is preparing your document';
    case 'DOWNLOADING':
    case 'PROCESSING':
      return 'Printer is processing your job';
    case 'SUBMITTED_TO_CUPS':
    case 'PRINTING':
      return 'Printing started';
    case 'COMPLETED':
      return 'Printing completed';
    case 'PRINTER_OFFLINE':
      return 'Printer temporarily offline';
    case 'FAILED':
    case 'RECOVERY_REQUIRED':
      return 'Print failed — assistance required';
    case 'CANCELLED':
      return 'Job cancelled';
    default:
      return status;
  }
}
