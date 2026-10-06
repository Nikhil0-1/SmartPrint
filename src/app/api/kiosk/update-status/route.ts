import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { PrintJobStatus } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const { job_id, status, cups_job_id, error_message, recovery_reason } = await request.json();

    if (!job_id || !status) {
      return NextResponse.json({ error: 'job_id and status are required' }, { status: 400 });
    }

    const updatedJob = store.updateJobStatus(job_id, status as PrintJobStatus, {
      cups_job_id,
      error_message,
      recovery_reason,
    });

    if (!updatedJob) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, job: updatedJob });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
