import { handleGetKioskStatus, handlePostKioskStatus } from '@/lib/kioskStatus';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ kioskId: string }> }
) {
  const resolvedParams = await params;
  return handleGetKioskStatus(resolvedParams.kioskId);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ kioskId: string }> }
) {
  const resolvedParams = await params;
  const body = await request.json().catch(() => ({}));
  return handlePostKioskStatus(resolvedParams.kioskId, body);
}
