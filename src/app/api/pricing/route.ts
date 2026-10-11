import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { authenticateRequest } from '@/lib/auth';

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
    const auth = await authenticateRequest(request);
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: auth.error || 'Authentication required' }, { status: auth.status });
    }

    const body = await request.json();
    const adminEmail = auth.user.email;
    const orgId = body.organization_id || auth.user.authorizedOrganizationIds[0] || GITAM_ORG_ID;

    if (!auth.user.isSuperAdmin && !auth.user.authorizedOrganizationIds.includes(orgId)) {
      return NextResponse.json({ error: 'Access denied to update pricing for this organization' }, { status: 403 });
    }

    const updated = store.updatePricing(orgId, body, adminEmail);
    return NextResponse.json({ success: true, pricing: updated });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    );
  }
}
