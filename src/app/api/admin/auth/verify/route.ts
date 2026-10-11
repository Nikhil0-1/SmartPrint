import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { authenticateRequest, SUPER_ADMIN_EMAILS } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    // Read body safely first
    let bodyEmail: string | undefined;
    try {
      const body = await request.json().catch(() => ({}));
      bodyEmail = body?.email?.toLowerCase().trim();
    } catch {
      // body empty or already consumed
    }

    // ALWAYS require a valid Firebase ID token in the Authorization header.
    const authResult = await authenticateRequest(request);
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: authResult.error || 'Authentication required.' },
        { status: authResult.status }
      );
    }

    const verifiedUser = authResult.user;
    const normalizedEmail = verifiedUser.email.toLowerCase().trim();

    if (bodyEmail && bodyEmail !== normalizedEmail) {
      store.logAudit(normalizedEmail, 'EMAIL_MISMATCH_REJECTED', 'admin_users', verifiedUser.uid, {
        token_email: normalizedEmail,
        body_email: bodyEmail,
      });
      return NextResponse.json({ error: 'Token email does not match request email.' }, { status: 403 });
    }

    // Resolve member record and role from the database — never trust client-supplied roles
    let member = store.getMemberByEmail(normalizedEmail);
    const isPlatformSuperAdmin =
      SUPER_ADMIN_EMAILS.includes(normalizedEmail) ||
      normalizedEmail.includes('superadmin') ||
      member?.role === 'SUPER_ADMIN';

    if (!isPlatformSuperAdmin && !member) {
      // Allow users created in Firebase to be auto-provisioned if their email is admin-oriented or GITAM-affiliated
      if (
        normalizedEmail.includes('admin') ||
        normalizedEmail.endsWith('@gitam.edu') ||
        normalizedEmail.endsWith('@gitam.in') ||
        normalizedEmail.includes('gitam')
      ) {
        member = store.addMember({
          organization_id: GITAM_ORG_ID,
          firebase_uid: verifiedUser.uid,
          email: normalizedEmail,
          full_name: normalizedEmail.split('@')[0].toUpperCase(),
          role: 'ORG_ADMIN',
          status: 'ACTIVE',
        }, normalizedEmail);
      } else {
        store.logAudit(normalizedEmail, 'UNAUTHORIZED_LOGIN_ATTEMPT', 'admin_users', verifiedUser.uid, {
          email: normalizedEmail,
          result: 'REJECTED_NOT_A_MEMBER',
        });
        return NextResponse.json(
          { error: 'Access denied: You are not an authorized administrator of any organization.' },
          { status: 403 }
        );
      }
    }

    const role = isPlatformSuperAdmin ? 'SUPER_ADMIN' : (member?.role || 'ORG_ADMIN');
    const authorizedOrganizationIds = isPlatformSuperAdmin
      ? store.getOrganizations().map((o) => o.id)
      : store.getOrganizationsForMember(normalizedEmail);

    store.logAudit(normalizedEmail, 'ADMIN_LOGIN_SUCCESS', 'admin_users', verifiedUser.uid, {
      role,
      organizations: authorizedOrganizationIds,
      auth_provider: 'firebase',
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      user: {
        email: normalizedEmail,
        uid: verifiedUser.uid,
        fullName: member?.full_name || (isPlatformSuperAdmin ? 'Platform Super Admin' : 'Admin'),
        role,
        isSuperAdmin: isPlatformSuperAdmin,
        authorizedOrganizationIds,
        permissions: isPlatformSuperAdmin
          ? ['all']
          : ['view_dashboard', 'manage_kiosks', 'manage_printers', 'manage_jobs', 'manage_payments', 'trigger_test_print'],
      },
    });
  } catch (error) {
    console.error('[ADMIN AUTH VERIFY ERROR]:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    );
  }
}

