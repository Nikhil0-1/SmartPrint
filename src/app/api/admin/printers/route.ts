import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { Printer } from '@/lib/types';
import { authenticateRequest } from '@/lib/auth';
import {
  dbGetPrinters,
  dbCreatePrinter,
  dbUpdatePrinter,
  dbWriteAuditLog,
} from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('organization_id') || searchParams.get('org_id');
  const kioskId = searchParams.get('kiosk_id');

  const dbPrinters = await dbGetPrinters(orgId || undefined, kioskId || undefined);
  if (dbPrinters && dbPrinters.length > 0) {
    return NextResponse.json({ printers: dbPrinters });
  }

  const printers = store.getPrinters(orgId || undefined, kioskId || undefined);
  return NextResponse.json({ printers });
}

export async function POST(request: Request) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: auth.error || 'Authentication required' }, { status: auth.status });
    }

    const body = await request.json();
    const adminEmail = auth.user.email;

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

    // Persist to Supabase Database
    const dbPr = await dbCreatePrinter({
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
      last_test_print: null,
      last_error: null,
    });

    const newPrinter: Printer = {
      id: dbPr?.id || `printer_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
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
      created_at: dbPr?.created_at || new Date().toISOString(),
      updated_at: dbPr?.updated_at || new Date().toISOString(),
    };

    store.createPrinter(newPrinter, adminEmail);

    await dbWriteAuditLog({
      admin_email: adminEmail,
      action: 'CREATE_PRINTER',
      target_type: 'printer',
      target_id: newPrinter.id,
      details: { kiosk_id, printer_name, cups_queue_name },
    });

    return NextResponse.json({ success: true, printer: newPrinter });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: auth.error || 'Authentication required' }, { status: auth.status });
    }

    const { id, ...updates } = await request.json();
    const adminEmail = auth.user.email;

    if (!id) {
      return NextResponse.json({ error: 'printer id is required' }, { status: 400 });
    }

    // Persist to Supabase
    const dbUpdated = await dbUpdatePrinter(id, updates);

    // Keep store synchronized
    const storeUpdated = store.updatePrinter(id, updates, adminEmail);

    if (!dbUpdated && !storeUpdated) {
      return NextResponse.json({ error: 'Printer not found' }, { status: 404 });
    }

    await dbWriteAuditLog({
      admin_email: adminEmail,
      action: 'UPDATE_PRINTER',
      target_type: 'printer',
      target_id: id,
      details: updates,
    });

    return NextResponse.json({ success: true, printer: dbUpdated || storeUpdated });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

