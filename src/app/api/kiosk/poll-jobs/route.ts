import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { dbClaimNextPrintJob, dbGetPrinter } from '@/lib/db';
import { isSupabaseConfigured } from '@/lib/supabase';
import { authenticateDeviceRequest } from '@/lib/deviceAuth';

export async function POST(request: Request) {
  try {
    // 1. Authoritative Device Authentication
    const auth = await authenticateDeviceRequest(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { kiosk } = auth;
    const kioskId = kiosk.id;

    // 2. Check Maintenance Mode
    if (kiosk.maintenance_mode || kiosk.status === 'MAINTENANCE') {
      return NextResponse.json({ success: true, jobs: [], maintenance_mode: true });
    }

    // 3. ATOMIC FIFO QUEUE CLAIMING FROM DATABASE
    const workerId = `worker_${kioskId}_${Date.now()}`;
    const claimedJob = await dbClaimNextPrintJob(kioskId, workerId, 90);

    if (claimedJob) {
      let cupsQueueName = 'Pantum_M7108DW';
      if (claimedJob.printer_id) {
        const printer = await dbGetPrinter(claimedJob.printer_id);
        if (printer) {
          cupsQueueName = printer.cups_queue_name;
        }
      }

      const formattedJob = {
        id: claimedJob.id,
        idempotency_key: claimedJob.idempotency_key,
        organization_id: claimedJob.organization_id,
        kiosk_id: claimedJob.kiosk_id,
        printer_id: claimedJob.printer_id,
        cups_printer_name: cupsQueueName,
        cups_queue_name: cupsQueueName,
        pages_total: claimedJob.pages_total,
        pages_selected: claimedJob.pages_selected,
        copies: claimedJob.copies,
        is_color: claimedJob.is_color,
        is_duplex: claimedJob.is_duplex,
        orientation: claimedJob.orientation,
        paper_size: claimedJob.paper_size,
        status: 'DISPATCHED',
        signed_download_url: `/api/kiosk/download/${claimedJob.id}`,
      };

      return NextResponse.json({
        success: true,
        jobs: [formattedJob],
      });
    }

    // 4. In production with Supabase configured, authoritative store returns empty queue.
    // In-memory demo store is never permitted to serve mock jobs to production devices.
    if (isSupabaseConfigured()) {
      return NextResponse.json({
        success: true,
        jobs: [],
      });
    }

    // 5. Offline unit-testing fallback only when Supabase is not configured
    const pendingJobs = store.getPendingJobsForKiosk(kioskId);
    return NextResponse.json({
      success: true,
      jobs: pendingJobs,
    });
  } catch (error) {
    console.error('[POLL-JOBS ERROR]:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
