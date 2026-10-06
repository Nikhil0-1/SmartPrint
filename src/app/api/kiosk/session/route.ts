import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function POST(request: Request) {
  try {
    const { kiosk_id } = await request.json();
    if (!kiosk_id) {
      return NextResponse.json({ error: 'kiosk_id is required' }, { status: 400 });
    }

    const kiosk = store.getKiosk(kiosk_id);
    if (!kiosk) {
      return NextResponse.json({ error: 'Kiosk not found' }, { status: 404 });
    }

    const session = store.createSession(kiosk_id);
    return NextResponse.json({ success: true, session });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
