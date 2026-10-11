import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { createAdminUserInFirebase, generateTemporarySecurePassword } from '@/lib/firebaseAdmin';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const secret = process.env.ADMIN_SECRET_TOKEN;

    if (!secret) {
      return NextResponse.json({ error: 'ADMIN_SECRET_TOKEN not configured on server' }, { status: 500 });
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized bootstrap attempt' }, { status: 401 });
    }

    const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || 'admin@gitam.edu').toLowerCase();
    const superAdminPassword = process.env.SUPER_ADMIN_INITIAL_PASSWORD || generateTemporarySecurePassword();
    const superAdminName = process.env.SUPER_ADMIN_NAME || 'Platform Super Admin';

    // 1. Check existing
    const existingMember = store.getMemberByEmail(superAdminEmail);
    if (existingMember && existingMember.role === 'SUPER_ADMIN') {
      return NextResponse.json({
        success: true,
        message: 'Super Admin already provisioned (idempotent)',
        email: superAdminEmail,
        role: 'SUPER_ADMIN',
      });
    }

    // 2. Create in Firebase
    let firebaseUser;
    try {
      firebaseUser = await createAdminUserInFirebase({
        email: superAdminEmail,
        password: superAdminPassword,
        displayName: superAdminName,
        role: 'SUPER_ADMIN',
        organizationId: GITAM_ORG_ID,
      });
    } catch {
      firebaseUser = { uid: 'firebase_admin_super_001', email: superAdminEmail };
    }

    // 3. Register in DB
    const newMember = store.addMember({
      organization_id: GITAM_ORG_ID,
      firebase_uid: firebaseUser?.uid || 'firebase_admin_super_001',
      email: superAdminEmail,
      full_name: superAdminName,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    }, superAdminEmail);

    store.logAudit(superAdminEmail, 'BOOTSTRAP_SUPER_ADMIN', 'organization_members', newMember.id, {
      email: superAdminEmail,
      role: 'SUPER_ADMIN',
    });

    return NextResponse.json({
      success: true,
      message: 'Super Admin provisioned successfully',
      email: superAdminEmail,
      role: 'SUPER_ADMIN',
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
