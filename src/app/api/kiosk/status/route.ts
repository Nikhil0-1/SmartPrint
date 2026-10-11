import { handleGetKioskStatus, handlePostKioskStatus } from '@/lib/kioskStatus';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const kioskId = searchParams.get('kiosk_id') || searchParams.get('kioskId') || 'GITAM-SPK-001';
  return handleGetKioskStatus(kioskId);
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const kioskId = searchParams.get('kiosk_id') || searchParams.get('kioskId') || 'GITAM-SPK-001';
  const body = await request.json().catch(() => ({}));
  return handlePostKioskStatus(kioskId, body);
}
