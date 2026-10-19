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
    if (payload.cpu_temp !== undefined && payload.cpu_temp !== null) {
      telemetry.cpu_temp_celsius = payload.cpu_temp;
    }
    if (payload.ram_usage !== undefined && payload.ram_usage !== null) {
      telemetry.ram_usage_percent = payload.ram_usage;
    }
    if (payload.disk_usage !== undefined && payload.disk_usage !== null) {
      telemetry.disk_usage_percent = payload.disk_usage;
    }
    if (payload.agent_version) {
      telemetry.agent_version = payload.agent_version;
    }

    // Capture dynamic IP: from payload if reported by agent, or incoming request headers
    const clientIp =
      payload.ip_address ||
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      undefined;

    if (clientIp) {
      telemetry.ip_address = clientIp;
    }

    await dbUpdateKioskHeartbeat(kioskId, telemetry);

    // Dynamic Hardware Model tracking in Supabase settings
    if (payload.hardware_model && isSupabaseConfigured()) {
      try {
        const { data: curSetting } = await supabaseAdmin
          .from('settings')
          .select('value')
          .eq('key', 'kiosk_hardware_info')
          .single();

        const currentMap = (curSetting?.value as Record<string, any>) || {};
        currentMap[kioskId] = {
          ...currentMap[kioskId],
          hardware_model: payload.hardware_model,
          ip_address: clientIp || currentMap[kioskId]?.ip_address || null,
          updated_at: new Date().toISOString(),
        };

        await supabaseAdmin.from('settings').upsert(
          {
            key: 'kiosk_hardware_info',
            value: currentMap,
            description: 'Dynamic hardware model and edge telemetry per kiosk',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' }
        );
      } catch (err) {
        console.warn('[HEARTBEAT] Failed to update hardware info in settings:', err);
      }
    }

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
        cpu_temp: payload.cpu_temp ?? null,
        ram_usage: payload.ram_usage ?? null,
        disk_usage: payload.disk_usage ?? null,
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
