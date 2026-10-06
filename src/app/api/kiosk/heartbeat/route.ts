import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function POST(request: Request) {
  try {
    const kioskId = request.headers.get('x-kiosk-id') || (await request.clone().json()).kiosk_id;
    const deviceToken = request.headers.get('x-device-token');

    if (!kioskId) {
      return NextResponse.json({ error: 'Kiosk identification required' }, { status: 401 });
    }

    const kiosk = store.getKiosk(kioskId);
    if (!kiosk) {
      return NextResponse.json({ error: 'Unregistered kiosk device' }, { status: 404 });
    }

    // Check device token if provided in header
    if (deviceToken && deviceToken !== kiosk.device_token_hash) {
      return NextResponse.json({ error: 'Invalid device credentials' }, { status: 403 });
    }

    const payload = await request.json();
    store.recordHeartbeat(kioskId, {
      cpu_temp: payload.cpu_temp,
      ram_usage: payload.ram_usage,
      disk_usage: payload.disk_usage,
      printer_status: payload.printer_status,
      printer_message: payload.printer_message,
      agent_version: payload.agent_version,
    });

    return NextResponse.json({
      success: true,
      maintenance_mode: kiosk.maintenance_mode,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
