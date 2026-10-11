import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  let orgId = searchParams.get('org_id') || searchParams.get('organization_id') || '';
  const orgSlug = searchParams.get('slug') || searchParams.get('org') || '';

  if (!orgId && orgSlug) {
    const org = store.getOrganizationBySlug(orgSlug);
    if (org) orgId = org.id;
  }

  if (!orgId) {
    orgId = GITAM_ORG_ID;
  }

  const pricing = store.getPricing(orgId);
  return NextResponse.json({ success: true, pricing });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const adminEmail = request.headers.get('x-admin-email') || 'admin@gitam.edu';
    const orgId = body.organization_id || GITAM_ORG_ID;

    const updated = store.updatePricing(orgId, body, adminEmail);
    return NextResponse.json({ success: true, pricing: updated });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    );
  }
}
