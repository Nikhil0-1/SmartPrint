import { NextResponse } from 'next/server';
import { dbGetKiosk, dbUpdateKioskHeartbeat, dbUpdateDeviceHeartbeat } from '@/lib/db';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
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

    let payload: Record<string, any> = {};
    try {
      payload = await request.json();
    } catch {
      // Heartbeat body is optional if telemetry is not yet ready
    }

    // 2. Persist telemetry to Supabase (kiosk table)
    const telemetry: Parameters<typeof dbUpdateKioskHeartbeat>[1] = {
      status: kiosk.maintenance_mode ? 'MAINTENANCE' : 'ONLINE',
    };
    if (payload.cpu_temp !== undefined) telemetry.cpu_temp_celsius = payload.cpu_temp;
    if (payload.ram_usage !== undefined) telemetry.ram_usage_percent = payload.ram_usage;
    if (payload.disk_usage !== undefined) telemetry.disk_usage_percent = payload.disk_usage;
    if (payload.agent_version) telemetry.agent_version = payload.agent_version;

    await dbUpdateKioskHeartbeat(kioskId, telemetry);

    // 3. Update the associated device record
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

    // 4. Record health metrics snapshot
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

    // 5. Re-fetch fresh maintenance_mode for agent response
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
