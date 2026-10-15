import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { dbUpdatePrintJobStatus, dbWriteSystemLog } from '@/lib/db';
import { PrintJobStatus } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const { job_id, status, cups_job_id, error_message, recovery_reason } = await request.json();

    if (!job_id || !status) {
      return NextResponse.json({ error: 'job_id and status are required' }, { status: 400 });
    }

    // Authoritative database update
    await dbUpdatePrintJobStatus(
      job_id,
      status as any,
      error_message || recovery_reason,
      cups_job_id
    );

    // Also update in-memory store
    const updatedJob = store.updateJobStatus(job_id, status as PrintJobStatus, {
      cups_job_id,
      error_message,
      recovery_reason,
    });

    if (error_message || recovery_reason) {
      await dbWriteSystemLog({
        level: 'WARNING',
        component: 'RASPBERRY_PI',
        job_id,
        message: `Job ${job_id} status changed to ${status}: ${error_message || recovery_reason}`,
      });
    }

    return NextResponse.json({
      success: true,
      job_id,
      status,
      job: updatedJob || null,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
