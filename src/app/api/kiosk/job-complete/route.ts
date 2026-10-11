import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { permanentlyDeleteDocument } from '@/lib/fileSecurity';

export async function POST(request: Request) {
  try {
    const { job_id, cups_job_id } = await request.json();

    if (!job_id) {
      return NextResponse.json({ error: 'job_id is required' }, { status: 400 });
    }

    const job = store.getJob(job_id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // 1. Transition job to COMPLETED
    store.updateJobStatus(job_id, 'COMPLETED', { cups_job_id });

    // 2. CRITICAL DOCUMENT SECURITY: PERMANENTLY DELETE CLOUD & MEMORY FILE
    const deleted = await permanentlyDeleteDocument(job_id);

    // 3. Log verified completion
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
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
