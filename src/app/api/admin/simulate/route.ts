import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { dbGetPrintJob, dbUpdatePrintJobStatus } from '@/lib/db';
import { permanentlyDeleteDocument } from '@/lib/fileSecurity';

export async function POST(request: Request) {
  try {
    const { action, job_id, kiosk_id } = await request.json();

    if (action === 'simulate_heartbeat') {
      const targetKioskId = kiosk_id || 'GITAM-SPK-001';
      store.recordHeartbeat(targetKioskId, {
        cpu_temp: 43.8 + Math.round((Math.random() * 2 - 1) * 10) / 10,
        ram_usage: 35.2 + Math.round((Math.random() * 4 - 2) * 10) / 10,
        disk_usage: 18.9,
        printer_status: 'READY',
        printer_message: 'HP LaserJet USB Queue Ready',
        agent_version: '1.0.0',
      });
      return NextResponse.json({ success: true, message: `Simulated heartbeat recorded for ${targetKioskId}` });
    }

    if (action === 'simulate_print_lifecycle') {
      if (!job_id) {
        return NextResponse.json({ error: 'job_id is required' }, { status: 400 });
      }

      let job = store.getJob(job_id);
      if (!job) {
        const dbJob = await dbGetPrintJob(job_id);
        if (dbJob) {
          job = {
            id: dbJob.id,
            organization_id: dbJob.organization_id || '',
            kiosk_id: dbJob.kiosk_id,
            status: dbJob.status as any,
            created_at: dbJob.created_at,
          } as any;
        }
      }

      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      // 1. Advance to DOWNLOADING
      store.updateJobStatus(job_id, 'DOWNLOADING');
      await dbUpdatePrintJobStatus(job_id, 'DOWNLOADING');

      // 2. Advance to PROCESSING
      store.updateJobStatus(job_id, 'PROCESSING');
      await dbUpdatePrintJobStatus(job_id, 'PROCESSING');

      // 3. Submit to CUPS
      const mockCupsId = Math.floor(100 + Math.random() * 900);
      store.updateJobStatus(job_id, 'SUBMITTED_TO_CUPS', { cups_job_id: mockCupsId });
      await dbUpdatePrintJobStatus(job_id, 'SUBMITTED_TO_CUPS', undefined, mockCupsId);

      // 4. PRINTING
      store.updateJobStatus(job_id, 'PRINTING', { cups_job_id: mockCupsId });
      await dbUpdatePrintJobStatus(job_id, 'PRINTING', undefined, mockCupsId);

      // 5. COMPLETED & IMMEDIATE DOCUMENT PURGE
      store.updateJobStatus(job_id, 'COMPLETED', { cups_job_id: mockCupsId });
      await dbUpdatePrintJobStatus(job_id, 'COMPLETED', undefined, mockCupsId);
      if (kiosk_id) {
        store.releaseKioskJob(kiosk_id, job_id);
      }
      const deleted = await permanentlyDeleteDocument(job_id);

      return NextResponse.json({
        success: true,
        message: 'Simulation complete: Job transitioned to COMPLETED and document purged.',
        cups_job_id: mockCupsId,
        cleanup_verified: deleted,
      });
    }

    return NextResponse.json({ error: 'Unknown simulation action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
