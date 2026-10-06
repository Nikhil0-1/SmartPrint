import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function GET() {
  const kiosks = store.getKiosks();
  const printers = store.getPrinters();
  const branding = store.getBranding();

  return NextResponse.json({
    status: 'PASS',
    timestamp: new Date().toISOString(),
    system: {
      product: branding.product,
      organization: branding.organization,
      powered_by: branding.powered_by,
      support: branding.support_number,
      environment: process.env.NODE_ENV || 'development',
    },
    components: {
      backend: 'ONLINE',
      database: 'ONLINE',
      temporary_storage: 'ONLINE',
      kiosks_online: kiosks.filter((k) => k.status === 'ONLINE').length,
      printers_ready: printers.filter((p) => p.status === 'READY').length,
    },
  });
}
