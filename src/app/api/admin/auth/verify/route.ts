import { NextResponse } from 'next/server';
import { authenticateRequest, SUPER_ADMIN_EMAILS } from '@/lib/auth';
import { dbWriteAuditLog, dbUpdateMemberFirebaseUid } from '@/lib/db';

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

    // Cross-check: if body includes an email, it must match the token email
    if (bodyEmail && bodyEmail !== normalizedEmail) {
      await dbWriteAuditLog({
        admin_email: normalizedEmail,
        action: 'EMAIL_MISMATCH_REJECTED',
        target_type: 'admin_users',
        target_id: verifiedUser.uid,
        details: {
          token_email: normalizedEmail,
          body_email: bodyEmail,
        },
      });
      return NextResponse.json(
        { error: 'Token email does not match request email.' },
        { status: 403 }
      );
    }

    // Update the firebase_uid in the database if the member was seeded with
    // a placeholder UID. This ensures future lookups by UID work correctly.
    await dbUpdateMemberFirebaseUid(normalizedEmail, verifiedUser.uid);

    // Log successful login
    await dbWriteAuditLog({
      admin_email: normalizedEmail,
      action: 'ADMIN_LOGIN_SUCCESS',
      target_type: 'admin_users',
      target_id: verifiedUser.uid,
      details: {
        role: verifiedUser.role,
        organizations: verifiedUser.authorizedOrganizationIds,
        auth_provider: 'firebase',
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      user: {
        email: normalizedEmail,
        uid: verifiedUser.uid,
        fullName: verifiedUser.fullName,
        role: verifiedUser.role,
        isSuperAdmin: verifiedUser.isSuperAdmin,
        authorizedOrganizationIds: verifiedUser.authorizedOrganizationIds,
        permissions: verifiedUser.isSuperAdmin
          ? ['all']
          : [
              'view_dashboard',
              'manage_kiosks',
              'manage_printers',
              'manage_jobs',
              'manage_payments',
              'trigger_test_print',
            ],
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
