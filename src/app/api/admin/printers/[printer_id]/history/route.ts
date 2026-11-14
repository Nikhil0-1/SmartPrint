import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { dbGetPrinterPrintHistory } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ printer_id: string }> }
) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: auth.error || 'Authentication required' }, { status: auth.status });
    }

    const { printer_id } = await params;
    if (!printer_id) {
      return NextResponse.json({ error: 'printer_id is required' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '25', 10);

    const history = await dbGetPrinterPrintHistory(printer_id, limit);
    return NextResponse.json({ success: true, history });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
