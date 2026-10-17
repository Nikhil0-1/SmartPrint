import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { authenticateRequest } from '@/lib/auth';
import { dbGetRouting, dbGetRoutings, dbUpsertRouting, dbGetPrinters, dbWriteAuditLog } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('organization_id');
  const kioskId = searchParams.get('kiosk_id');

  if (kioskId) {
    const dbRoute = await dbGetRouting(kioskId);
    if (dbRoute) {
      return NextResponse.json({ routings: [dbRoute] });
    }
  } else {
    const dbRoutes = await dbGetRoutings();
    if (dbRoutes && dbRoutes.length > 0) {
      return NextResponse.json({ routings: dbRoutes });
    }
  }

  const routings = store.getAllRoutings(orgId || undefined);
  return NextResponse.json({ routings });
}

export async function POST(request: Request) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: auth.error || 'Authentication required' }, { status: auth.status });
    }

    const body = await request.json();
    const adminEmail = auth.user.email;
    const { kiosk_id, ...updates } = body;

    if (!kiosk_id) {
      return NextResponse.json({ error: 'kiosk_id is required' }, { status: 400 });
    }

    // Capability Safety Check before saving routing overrides
    let printers = await dbGetPrinters(undefined, kiosk_id);
    if (!printers || printers.length === 0) {
      printers = (store.getPrinters(undefined, kiosk_id) as any[]) || [];
    }

    if (updates.bw_primary_printer_id) {
      const bwPr = printers.find((p) => p.id === updates.bw_primary_printer_id);
      if (!bwPr) {
        return NextResponse.json({ error: 'Selected B&W primary printer does not exist.' }, { status: 400 });
      }
    }

    if (updates.color_primary_printer_id) {
      const colorPr = printers.find((p) => p.id === updates.color_primary_printer_id);
      if (colorPr && !colorPr.supports_color) {
        return NextResponse.json(
          { error: `Cannot assign B&W-only printer (${colorPr.display_name || colorPr.printer_name}) to Color routing route.` },
          { status: 400 }
        );
      }
    }

    // Persist to Supabase Database (Authoritative Source of Truth)
    const savedRouting = await dbUpsertRouting(kiosk_id, updates);

    // Keep in-memory store synchronized for current runtime
    const storeRouting = store.updateRouting(kiosk_id, updates, adminEmail);

    await dbWriteAuditLog({
      admin_email: adminEmail,
      action: 'UPDATE_PRINTER_ROUTING',
      target_type: 'printer_routing',
      target_id: kiosk_id,
      details: updates,
    });

    return NextResponse.json({ success: true, routing: savedRouting || storeRouting });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

