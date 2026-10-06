import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function GET() {
  const pricing = store.getPricing();
  return NextResponse.json({ success: true, pricing });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const adminEmail = request.headers.get('x-admin-email') || 'admin@gitam.edu';
    const updated = store.updatePricing(body, adminEmail);
    return NextResponse.json({ success: true, pricing: updated });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    );
  }
}
