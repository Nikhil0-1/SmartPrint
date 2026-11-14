import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { dbGetPrinters, dbWriteAuditLog } from '@/lib/db';
import { store } from '@/lib/store';

export async function POST(request: Request) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: auth.error || 'Authentication required' }, { status: auth.status });
    }

    const { kiosk_id } = await request.json();
    if (!kiosk_id) {
      return NextResponse.json({ error: 'kiosk_id is required' }, { status: 400 });
    }

    // Retrieve currently discovered printers for this kiosk
    let printers = await dbGetPrinters(undefined, kiosk_id);
    if (!printers || printers.length === 0) {
      printers = (store.getPrinters(undefined, kiosk_id) as any[]) || [];
    }

    await dbWriteAuditLog({
      admin_email: auth.user.email,
      action: 'TRIGGER_PRINTER_DISCOVERY',
      target_type: 'kiosk',
      target_id: kiosk_id,
      details: { discovered_count: printers.length },
    });

    return NextResponse.json({
      success: true,
      kiosk_id,
      printers,
      message: `Discovery scan retrieved ${printers.length} active printer(s) for ${kiosk_id}.`,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
