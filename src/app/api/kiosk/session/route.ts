import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';

export async function POST(request: Request) {
  try {
    const { kiosk_id, organization_id, org_slug, kiosk_slug } = await request.json();

    let targetKiosk = kiosk_id ? store.getKiosk(kiosk_id) : undefined;
    let targetOrgId = organization_id;

    if (!targetKiosk && org_slug && kiosk_slug) {
      const org = store.getOrganizationBySlug(org_slug);
      if (org) {
        targetOrgId = org.id;
        targetKiosk = store.getKioskBySlug(kiosk_slug, org.id);
      }
    } else if (!targetKiosk && kiosk_slug) {
      targetKiosk = store.getKioskBySlug(kiosk_slug);
    }

    if (!targetKiosk) {
      return NextResponse.json({ error: 'Kiosk not found or inactive.' }, { status: 404 });
    }

    if (!targetOrgId) {
      targetOrgId = targetKiosk.organization_id || GITAM_ORG_ID;
    }

    const session = store.createSession(targetKiosk.id, targetOrgId);
    return NextResponse.json({
      success: true,
      session,
      kiosk: {
        id: targetKiosk.id,
        name: targetKiosk.name,
        location: targetKiosk.location,
        status: targetKiosk.status,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'token parameter is required' }, { status: 400 });
  }

  const session = store.getSession(token);
  if (!session) {
    return NextResponse.json({ error: 'Session not found or expired.' }, { status: 404 });
  }

  const kiosk = store.getKiosk(session.kiosk_id);
  const org = store.getOrganization(session.organization_id || GITAM_ORG_ID);

  return NextResponse.json({
    success: true,
    session,
    kiosk,
    organization: org,
  });
}
