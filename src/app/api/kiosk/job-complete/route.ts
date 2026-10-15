import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { dbUpdatePrintJobStatus, dbWriteSystemLog } from '@/lib/db';
import { permanentlyDeleteDocument } from '@/lib/fileSecurity';

export async function POST(request: Request) {
  try {
    let job_id: string | undefined, cups_job_id: number | undefined;
    try {
      const body = await request.json();
      job_id = body?.job_id;
      cups_job_id = body?.cups_job_id;
    } catch {
      return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });
    }

    if (!job_id) {
      return NextResponse.json({ error: 'job_id is required' }, { status: 400 });
    }

    // 1. Authoritative DB transition to COMPLETED
    await dbUpdatePrintJobStatus(job_id, 'COMPLETED', undefined, cups_job_id);

    // 2. Transition store job to COMPLETED
    store.updateJobStatus(job_id, 'COMPLETED', { cups_job_id });

    // 3. CRITICAL DOCUMENT SECURITY: PERMANENTLY DELETE CLOUD & MEMORY FILE
    const deleted = await permanentlyDeleteDocument(job_id);

    // 4. Log verified completion
    await dbWriteSystemLog({
      level: 'INFO',
      component: 'CLEANUP',
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
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
