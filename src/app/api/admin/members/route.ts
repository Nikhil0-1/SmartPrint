import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { dbGetMembersByOrg, dbUpsertMember, dbWriteAuditLog } from '@/lib/db';
import { GITAM_ORG_ID, store } from '@/lib/store';

export async function GET(request: Request) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: auth.error || 'Authentication required' }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('org_id') || auth.user.authorizedOrganizationIds[0] || GITAM_ORG_ID;

    const dbMembers = await dbGetMembersByOrg(orgId);
    return NextResponse.json({
      success: true,
      members: dbMembers.length > 0 ? dbMembers : [
        {
          id: 'mem-001',
          organization_id: orgId,
          email: 'admin@gitam.edu',
          full_name: 'GITAM Super Administrator',
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          created_at: new Date().toISOString(),
        },
        {
          id: 'mem-002',
          organization_id: orgId,
          email: 'operator@gitam.edu',
          full_name: 'Campus Kiosk Operator',
          role: 'OPERATOR',
          status: 'ACTIVE',
          created_at: new Date().toISOString(),
        },
      ],
    });
  } catch (error) {
    console.error('[MEMBERS GET ERROR]:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: auth.error || 'Authentication required' }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));
    const { email, full_name, role, organization_id, status } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const targetOrg = organization_id || auth.user.authorizedOrganizationIds[0] || GITAM_ORG_ID;
    const memberRole = role || 'OPERATOR';
    const memberStatus = status || 'ACTIVE';

    const saved = await dbUpsertMember({
      organization_id: targetOrg,
      firebase_uid: `uid_${Date.now()}`,
      email: email.toLowerCase(),
      full_name: full_name || email.split('@')[0],
      role: memberRole,
      status: memberStatus,
    });

    await dbWriteAuditLog({
      admin_email: auth.user.email,
      action: 'ADD_MEMBER',
      target_type: 'member',
      target_id: email,
      details: { role: memberRole, status: memberStatus },
      organization_id: targetOrg,
    });

    return NextResponse.json({ success: true, member: saved });
  } catch (error) {
    console.error('[MEMBERS POST ERROR]:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: auth.error || 'Authentication required' }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));
    const { email, role, status, organization_id } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const targetOrg = organization_id || auth.user.authorizedOrganizationIds[0] || GITAM_ORG_ID;

    const saved = await dbUpsertMember({
      organization_id: targetOrg,
      firebase_uid: '',
      email: email.toLowerCase(),
      full_name: body.full_name || email.split('@')[0],
      role: role || 'OPERATOR',
      status: status || 'ACTIVE',
    });

    await dbWriteAuditLog({
      admin_email: auth.user.email,
      action: 'UPDATE_MEMBER',
      target_type: 'member',
      target_id: email,
      details: { role, status },
      organization_id: targetOrg,
    });

    return NextResponse.json({ success: true, member: saved });
  } catch (error) {
    console.error('[MEMBERS PUT ERROR]:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
