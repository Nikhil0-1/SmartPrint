import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { authenticateRequest } from '@/lib/auth';
import {
  dbGetBranding,
  dbUpsertBranding,
  dbGetOrganizationBySlug,
  dbGetOrganization,
  dbWriteAuditLog,
} from '@/lib/db';
import { DEFAULT_BRANDING } from '@/lib/constants';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  let orgId = searchParams.get('org_id') || searchParams.get('organization_id') || '';
  const orgSlug = searchParams.get('slug') || searchParams.get('org') || '';

  if (!orgId && orgSlug) {
    const org = await dbGetOrganizationBySlug(orgSlug);
    if (org) {
      orgId = org.id;
    } else {
      const storeOrg = store.getOrganizationBySlug(orgSlug);
      if (storeOrg) orgId = storeOrg.id;
    }
  }

  if (!orgId) {
    orgId = GITAM_ORG_ID;
  }

  // Fetch branding from Supabase, fallback to store
  const dbBranding = await dbGetBranding(orgId);
  const storeBranding = store.getBranding(orgId);
  const branding = dbBranding || storeBranding || { ...DEFAULT_BRANDING, organization_id: orgId };

  const dbOrganization = await dbGetOrganization(orgId);
  const storeOrganization = store.getOrganization(orgId);
  const organization = dbOrganization || storeOrganization;

  return NextResponse.json({
    success: true,
    branding,
    organization: organization
      ? {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          brand_colors: organization.brand_colors,
          logo_url: organization.logo_url,
          status: organization.status,
        }
      : null,
  });
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
      return NextResponse.json(
        { error: 'Access denied to update branding for this organization' },
        { status: 403 }
      );
    }

    // Validate input — only allow known branding fields
    const allowed = [
      'organization', 'product', 'primary_tagline', 'secondary_tagline',
      'powered_by', 'support_number', 'primary_color', 'secondary_color',
      'accent_color', 'bg_color', 'logo_url', 'welcome_message',
      'instructions', 'success_message', 'maintenance_message',
    ];
    const sanitized: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) sanitized[key] = body[key];
    }

    if (Object.keys(sanitized).length === 0) {
      return NextResponse.json({ error: 'No valid branding fields provided.' }, { status: 400 });
    }

    // Persist to Supabase — this is the source of truth
    const updated = await dbUpsertBranding(orgId, sanitized);
    if (!updated) {
      return NextResponse.json(
        { error: 'Database write failed. Branding was NOT saved.' },
        { status: 500 }
      );
    }

    // Audit log
    await dbWriteAuditLog({
      admin_email: adminEmail,
      action: 'UPDATE_BRANDING',
      target_type: 'branding',
      target_id: orgId,
      details: sanitized,
      organization_id: orgId,
    });

    return NextResponse.json({ success: true, branding: updated });
  } catch (error) {
    console.error('[BRANDING PUT ERROR]:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    );
  }
}
