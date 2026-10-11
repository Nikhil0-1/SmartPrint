import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('organization_id');
  const routings = store.getAllRoutings(orgId || undefined);
  return NextResponse.json({ routings });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const adminEmail = request.headers.get('x-admin-email') || 'admin@gitam.edu';
    const { kiosk_id, ...updates } = body;

    if (!kiosk_id) {
      return NextResponse.json({ error: 'kiosk_id is required' }, { status: 400 });
    }

    // Capability Safety Check before saving routing overrides
    const printers = store.getPrinters(undefined, kiosk_id);

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
          { error: `Cannot assign B&W-only printer (${colorPr.display_name}) to Color routing route.` },
          { status: 400 }
        );
      }
    }

    const updatedRouting = store.updateRouting(kiosk_id, updates, adminEmail);
    return NextResponse.json({ success: true, routing: updatedRouting });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
