import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function POST(request: Request) {
  try {
    // Try header first, then parse body once
    const headerKioskId = request.headers.get('x-kiosk-id');
    let kioskId = headerKioskId;
    if (!kioskId) {
      try {
        const body = await request.json();
        kioskId = body.kiosk_id;
      } catch {
        // no body is fine if header was provided
      }
    }

    if (!kioskId) {
      return NextResponse.json({ error: 'Kiosk identification required' }, { status: 401 });
    }

    const kiosk = store.getKiosk(kioskId);
    if (!kiosk) {
      return NextResponse.json({ error: 'Unregistered kiosk' }, { status: 404 });
    }

    // If kiosk is in maintenance mode, do not dispatch jobs
    if (kiosk.maintenance_mode) {
      return NextResponse.json({ jobs: [], maintenance_mode: true });
    }

    const pendingJobs = store.getPendingJobsForKiosk(kioskId);
    return NextResponse.json({
      success: true,
      jobs: pendingJobs,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
