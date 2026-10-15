import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { dbClaimNextPrintJob, dbGetKiosk, dbGetPrinter } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const headerKioskId = request.headers.get('x-kiosk-id');
    const headerDeviceToken = request.headers.get('x-device-token');

    let kioskId = headerKioskId;
    let deviceToken = headerDeviceToken;

    try {
      const body = await request.json();
      if (!kioskId) kioskId = body.kiosk_id;
      if (!deviceToken) deviceToken = body.device_token;
    } catch {
      // Body may be empty if headers are provided
    }

    if (!kioskId) {
      return NextResponse.json({ error: 'Kiosk identification required' }, { status: 401 });
    }

    // 1. Authoritative Kiosk check
    const dbKiosk = await dbGetKiosk(kioskId);
    const storeKiosk = store.getKiosk(kioskId);

    if (!dbKiosk && !storeKiosk) {
      return NextResponse.json({ error: 'Unregistered kiosk' }, { status: 404 });
    }

    const isMaintenance = dbKiosk?.maintenance_mode ?? storeKiosk?.maintenance_mode ?? false;
    if (isMaintenance) {
      return NextResponse.json({ jobs: [], maintenance_mode: true });
    }

    // 2. ATOMIC FIFO QUEUE CLAIMING
    // Claims oldest eligible job with an exclusive worker lease
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
        signed_download_url: `/api/kiosk/download/${claimedJob.id}?token=${claimedJob.idempotency_key}`,
      };

      return NextResponse.json({
        success: true,
        jobs: [formattedJob],
      });
    }

    // 3. Fallback to in-memory store pending jobs if no DB job was claimed
    const pendingJobs = store.getPendingJobsForKiosk(kioskId);
    return NextResponse.json({
      success: true,
      jobs: pendingJobs,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
