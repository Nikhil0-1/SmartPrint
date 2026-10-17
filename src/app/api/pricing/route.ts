import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { authenticateRequest } from '@/lib/auth';
import {
  dbGetPricing,
  dbUpsertPricing,
  dbGetOrganizationBySlug,
  dbWriteAuditLog,
} from '@/lib/db';
import { DEFAULT_PRICING } from '@/lib/constants';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  let orgId = searchParams.get('org_id') || searchParams.get('organization_id') || '';
  const orgSlug = searchParams.get('slug') || searchParams.get('org') || '';

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (orgSlug || (orgId && !UUID_REGEX.test(orgId))) {
    const slugToFind = orgSlug || orgId;
    const org = await dbGetOrganizationBySlug(slugToFind);
    if (org) {
      orgId = org.id;
    } else {
      const storeOrg = store.getOrganizationBySlug(slugToFind);
      if (storeOrg) orgId = storeOrg.id;
    }
  }

  if (!orgId || !UUID_REGEX.test(orgId)) {
    orgId = GITAM_ORG_ID;
  }

  // Fetch pricing from Supabase (authoritative source), fallback to store
  const dbPricing = await dbGetPricing(orgId);
  const storePricing = store.getPricing(orgId);
  const pricing = dbPricing || storePricing || {
    ...DEFAULT_PRICING,
    organization_id: orgId,
    bw_price_paise: 100,
    color_price_paise: 500,
  };

  return NextResponse.json({
    success: true,
    pricing,
  });
}

export async function PUT(request: Request) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: auth.error || 'Authentication required' }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const paramOrgId = searchParams.get('org_id') || searchParams.get('organization_id') || '';
    const paramSlug = searchParams.get('slug') || searchParams.get('org') || '';

    const body = await request.json().catch(() => ({}));
    const adminEmail = auth.user.email;

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    let orgId = body.organization_id || body.org_id || paramOrgId;
    const slug = body.slug || paramSlug;

    if (slug || (orgId && !UUID_REGEX.test(orgId))) {
      const slugToFind = slug || orgId;
      const org = await dbGetOrganizationBySlug(slugToFind);
      if (org) {
        orgId = org.id;
      } else {
        const storeOrg = store.getOrganizationBySlug(slugToFind);
        if (storeOrg) orgId = storeOrg.id;
      }
    }

    if (!orgId || !UUID_REGEX.test(orgId)) {
      orgId = auth.user.authorizedOrganizationIds[0] || GITAM_ORG_ID;
    }

    if (!auth.user.isSuperAdmin && !auth.user.authorizedOrganizationIds.includes(orgId)) {
      return NextResponse.json(
        { error: 'Access denied to update pricing for this organization' },
        { status: 403 }
      );
    }

    // Validate numeric pricing values
    const numericFields = [
      'bw_price_per_page', 'color_price_per_page', 'service_charge',
      'min_order_amount', 'max_pages', 'max_copies', 'max_file_size_mb',
    ];
    const sanitized: Record<string, unknown> = { updated_by: adminEmail };

    for (const field of numericFields) {
      if (field in body && body[field] !== undefined && body[field] !== null && body[field] !== '') {
        const val = Number(body[field]);
        if (isNaN(val) || val < 0) {
          return NextResponse.json(
            { error: `Invalid value for ${field}: must be a non-negative number.` },
            { status: 400 }
          );
        }
        // Reasonable upper bounds
        if (field === 'bw_price_per_page' && val > 1000) {
          return NextResponse.json({ error: 'bw_price_per_page too high.' }, { status: 400 });
        }
        if (field === 'color_price_per_page' && val > 5000) {
          return NextResponse.json({ error: 'color_price_per_page too high.' }, { status: 400 });
        }
        sanitized[field] = val;
      }
    }

    if (Object.keys(sanitized).length <= 1) {
      return NextResponse.json({ error: 'No valid pricing fields provided.' }, { status: 400 });
    }

    // Persist to Supabase — authoritative source of truth
    const { data: updated, error: dbError } = await dbUpsertPricing(orgId, sanitized);
    if (dbError || !updated) {
      console.error('[PRICING PUT ERROR]:', dbError);
      return NextResponse.json(
        { success: false, error: dbError || 'Database write failed. Pricing was NOT saved.' },
        { status: 500 }
      );
    }

    // Keep store in sync
    store.updatePricing(orgId, updated as any, adminEmail);

    // Audit log
    await dbWriteAuditLog({
      admin_email: adminEmail,
      action: 'UPDATE_PRICING',
      target_type: 'pricing',
      target_id: orgId,
      details: sanitized,
      organization_id: orgId,
    });

    return NextResponse.json({ success: true, pricing: updated });
  } catch (error) {
    console.error('[PRICING PUT ERROR]:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    );
  }
}
