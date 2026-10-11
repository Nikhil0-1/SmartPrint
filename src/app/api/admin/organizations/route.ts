import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { requireSuperAdmin, authenticateRequest } from '@/lib/auth';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status });
  }

  // Super Admin gets all organizations; Org Admin gets only their authorized organizations
  let organizations = store.getOrganizations();
  if (!auth.user.isSuperAdmin) {
    organizations = organizations.filter((o) => auth.user!.authorizedOrganizationIds.includes(o.id));
  }

  return NextResponse.json({
    success: true,
    organizations,
  });
}

export async function POST(request: Request) {
  // Creating an organization strictly requires Platform Super Admin
  const auth = await requireSuperAdmin(request);
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: auth.error || 'Super Admin required to create organizations' }, { status: auth.status });
  }

  try {
    const body = await request.json();
    if (!body.name || !body.slug) {
      return NextResponse.json({ error: 'name and slug are required' }, { status: 400 });
    }

    const org = store.createOrganization(
      {
        name: body.name,
        slug: body.slug,
        brand_colors: body.brand_colors,
        public_url: body.public_url,
        logo_url: body.logo_url,
      },
      auth.user.email
    );

    // If an initial admin email is provided, assign them
    if (body.admin_email) {
      store.addMember(
        {
          organization_id: org.id,
          firebase_uid: `uid_${Date.now()}`,
          email: body.admin_email,
          full_name: body.admin_name || `${body.name} Admin`,
          role: 'ORG_ADMIN',
          status: 'ACTIVE',
        },
        auth.user.email
      );
    }

    return NextResponse.json({
      success: true,
      organization: org,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // Verify permission: Super Admin or Admin of that organization
    if (!auth.user.isSuperAdmin && !auth.user.authorizedOrganizationIds.includes(id)) {
      return NextResponse.json({ error: 'Access denied to this organization.' }, { status: 403 });
    }

    const updated = store.updateOrganization(id, updates, auth.user.email);
    if (!updated) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, organization: updated });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
