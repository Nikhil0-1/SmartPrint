import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { authenticateRequest } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: auth.error || 'Authentication required' }, { status: auth.status });
    }

    const { printer_id, kiosk_id } = await request.json();
    const adminEmail = auth.user.email;

    if (!printer_id && !kiosk_id) {
      return NextResponse.json({ error: 'printer_id or kiosk_id is required' }, { status: 400 });
    }

    const printer = printer_id
      ? store.getPrinter(printer_id)
      : store.getPrinters(undefined, kiosk_id)[0];

    if (!printer) {
      return NextResponse.json({ error: 'Target printer not found' }, { status: 404 });
    }

    const testPrintId = `test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const timestamp = new Date().toISOString();

    // Update printer last test print timestamp
    store.updatePrinter(printer.id, { last_test_print: timestamp }, adminEmail);

    store.logAudit(adminEmail, 'TEST_PRINT', 'printers', printer.id, {
      test_print_id: testPrintId,
      cups_queue_name: printer.cups_queue_name,
      kiosk_id: printer.kiosk_id,
    });

    store.logSystem('INFO', 'CUPS', `TEST PRINT DISPATCHED: Admin requested test print for ${printer.display_name} (${printer.cups_queue_name})`, {
      test_print_id: testPrintId,
      printer_id: printer.id,
      kiosk_id: printer.kiosk_id,
    });

    return NextResponse.json({
      success: true,
      test_print_id: testPrintId,
      printer_id: printer.id,
      printer_name: printer.display_name,
      cups_queue_name: printer.cups_queue_name,
      kiosk_id: printer.kiosk_id,
      timestamp,
      status: 'DISPATCHED_TO_AGENT',
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
