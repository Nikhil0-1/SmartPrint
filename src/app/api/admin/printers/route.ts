import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { Printer } from '@/lib/types';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('organization_id') || searchParams.get('org_id');
  const kioskId = searchParams.get('kiosk_id');
  const printers = store.getPrinters(orgId || undefined, kioskId || undefined);
  return NextResponse.json({ printers });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const adminEmail = request.headers.get('x-admin-email') || 'admin@gitam.edu';

    const {
      organization_id,
      kiosk_id,
      printer_name,
      display_name,
      manufacturer,
      model,
      cups_queue_name,
      connection_type,
      printer_type,
      supports_color,
      supports_duplex,
      capabilities,
      enabled,
      priority,
    } = body;

    if (!kiosk_id || !printer_name || !cups_queue_name) {
      return NextResponse.json(
        { error: 'kiosk_id, printer_name, and cups_queue_name are required' },
        { status: 400 }
      );
    }

    const kiosk = store.getKiosk(kiosk_id);
    const orgId = organization_id || kiosk?.organization_id || GITAM_ORG_ID;

    const newPrinter: Printer = {
      id: `printer_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      organization_id: orgId,
      kiosk_id,
      printer_name,
      display_name: display_name || printer_name,
      manufacturer: manufacturer || 'HP',
      model: model || printer_name,
      cups_queue_name,
      connection_type: connection_type || 'USB',
      status: 'READY',
      printer_type: printer_type || (supports_color ? 'COLOR' : 'BW'),
      enabled: enabled !== undefined ? enabled : true,
      priority: priority || 1,
      is_default: false,
      supports_color: Boolean(supports_color),
      supports_duplex: Boolean(supports_duplex),
      capabilities: capabilities || {
        color: Boolean(supports_color),
        grayscale: true,
        duplex: Boolean(supports_duplex),
        paper_sizes: ['A4'],
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    store.createPrinter(newPrinter, adminEmail);
    return NextResponse.json({ success: true, printer: newPrinter });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { id, ...updates } = await request.json();
    const adminEmail = request.headers.get('x-admin-email') || 'admin@gitam.edu';

    if (!id) {
      return NextResponse.json({ error: 'printer id is required' }, { status: 400 });
    }

    const updated = store.updatePrinter(id, updates, adminEmail);
    if (!updated) {
      return NextResponse.json({ error: 'Printer not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, printer: updated });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
