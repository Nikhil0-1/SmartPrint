import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { verifyFirebaseIdToken } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const { email, uid, token } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // If token provided, verify cryptographically / server-side
    if (token) {
      const verified = await verifyFirebaseIdToken(token);
      if (!verified) {
        return NextResponse.json({ error: 'Invalid or expired Firebase ID token.' }, { status: 401 });
      }
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Look up authorized member record from server database
    const member = store.getMemberByEmail(normalizedEmail);
    const isPlatformSuperAdmin =
      normalizedEmail === 'admin@gitam.edu' ||
      member?.role === 'SUPER_ADMIN';

    // If not super admin and no member record exists
    if (!isPlatformSuperAdmin && !member) {
      store.logAudit(normalizedEmail, 'UNAUTHORIZED_LOGIN_ATTEMPT', 'admin_users', uid, {
        email: normalizedEmail,
        result: 'REJECTED_NOT_A_MEMBER',
      });
      return NextResponse.json(
        { error: 'Access denied: You are not an authorized administrator of any organization.' },
        { status: 403 }
      );
    }

    const role = isPlatformSuperAdmin ? 'SUPER_ADMIN' : (member?.role || 'ORG_ADMIN');
    const authorizedOrganizationIds = isPlatformSuperAdmin
      ? store.getOrganizations().map((o) => o.id)
      : store.getOrganizationsForMember(normalizedEmail);

    store.logAudit(normalizedEmail, 'ADMIN_LOGIN_SUCCESS', 'admin_users', uid || 'firebase_uid', {
      role,
      organizations: authorizedOrganizationIds,
      auth_provider: 'firebase',
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      user: {
        email: normalizedEmail,
        uid: uid || member?.firebase_uid || 'firebase_uid',
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
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
