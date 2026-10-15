import { NextResponse } from 'next/server';
import { dbGetKiosk, dbUpdateKioskHeartbeat, dbUpdateDeviceHeartbeat, dbWriteSystemLog } from '@/lib/db';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const kioskId = request.headers.get('x-kiosk-id') || payload.kiosk_id;
    const deviceToken = request.headers.get('x-device-token');

    if (!kioskId) {
      return NextResponse.json({ error: 'Kiosk identification required' }, { status: 401 });
    }

    // Lookup kiosk from Supabase
    const kiosk = await dbGetKiosk(kioskId);
    if (!kiosk) {
      return NextResponse.json({ error: 'Unregistered kiosk device' }, { status: 404 });
    }

    // Verify device token
    if (deviceToken && deviceToken !== kiosk.device_token_hash) {
      await dbWriteSystemLog({
        level: 'WARNING',
        component: 'HEARTBEAT',
        kiosk_id: kioskId,
        message: `Invalid device token for kiosk ${kioskId}`,
      });
      return NextResponse.json({ error: 'Invalid device credentials' }, { status: 403 });
    }

    // Persist heartbeat to Supabase (kiosk table)
    const telemetry: Parameters<typeof dbUpdateKioskHeartbeat>[1] = {
      status: kiosk.maintenance_mode ? 'MAINTENANCE' : 'ONLINE',
    };
    if (payload.cpu_temp !== undefined) telemetry.cpu_temp_celsius = payload.cpu_temp;
    if (payload.ram_usage !== undefined) telemetry.ram_usage_percent = payload.ram_usage;
    if (payload.disk_usage !== undefined) telemetry.disk_usage_percent = payload.disk_usage;
    if (payload.agent_version) telemetry.agent_version = payload.agent_version;

    await dbUpdateKioskHeartbeat(kioskId, telemetry);

    // Also update the associated device record
    if (isSupabaseConfigured()) {
      const { data: device } = await supabaseAdmin
        .from('devices')
        .select('id')
        .eq('kiosk_id', kioskId)
        .single();

      if (device) {
        await dbUpdateDeviceHeartbeat(device.id, telemetry);
      }
    }

    // Record health metrics snapshot
    if (isSupabaseConfigured()) {
      await supabaseAdmin.from('health_metrics').insert({
        kiosk_id: kioskId,
        cpu_temp: payload.cpu_temp || null,
        ram_usage: payload.ram_usage || null,
        disk_usage: payload.disk_usage || null,
        printer_status: payload.printer_status || null,
        recorded_at: new Date().toISOString(),
      });
    }

    // Re-fetch the kiosk to get fresh maintenance_mode for response
    const refreshed = await dbGetKiosk(kioskId);

    return NextResponse.json({
      success: true,
      maintenance_mode: refreshed?.maintenance_mode ?? false,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[HEARTBEAT ERROR]:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
