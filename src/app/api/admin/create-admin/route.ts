import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { requireSuperAdmin } from '@/lib/auth';
import { createAdminUserInFirebase, generateTemporarySecurePassword } from '@/lib/firebaseAdmin';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    // 1. Strict Server-Side Super Admin Authorization
    const authResult = await requireSuperAdmin(request);
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: authResult.error || 'Super Admin authentication required' },
        { status: authResult.status }
      );
    }

    const body = await request.json();
    const {
      display_name,
      email,
      organization_id,
      initial_location_id,
      contact_number,
      custom_password,
    } = body;

    // 2. Validate required fields
    if (!display_name || !email || !organization_id) {
      return NextResponse.json(
        { error: 'Missing required fields: display_name, email, organization_id are required' },
        { status: 400 }
      );
    }

    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    // 3. Verify target organization exists
    const org = store.getOrganization(organization_id);
    if (!org) {
      return NextResponse.json({ error: `Organization '${organization_id}' not found` }, { status: 404 });
    }

    // 4. Duplicate Check
    const existing = store.getMemberByEmail(cleanEmail);
    if (existing) {
      return NextResponse.json(
        { error: `An administrator with email '${cleanEmail}' is already registered.` },
        { status: 409 }
      );
    }

    // 5. Generate secure initial credentials
    const temporaryPassword = custom_password || generateTemporarySecurePassword();

    // 6. Create Firebase Authentication User
    let firebaseUser;
    try {
      firebaseUser = await createAdminUserInFirebase({
        email: cleanEmail,
        password: temporaryPassword,
        displayName: display_name,
        role: 'ORG_ADMIN',
        organizationId: organization_id,
      });
    } catch (firebaseErr: any) {
      return NextResponse.json(
        { error: `Firebase user creation failed: ${firebaseErr.message}` },
        { status: 500 }
      );
    }

    // 7. Atomic Database Store Provisioning
    const newMember = store.addMember({
      organization_id,
      firebase_uid: firebaseUser?.uid || `fb_uid_${Date.now()}`,
      email: cleanEmail,
      full_name: display_name,
      role: 'ORG_ADMIN',
      status: 'ACTIVE',
    }, authResult.user.email);

    // 7b. Persist to Supabase PostgreSQL table
    if (isSupabaseConfigured()) {
      try {
        await supabaseAdmin.from('organization_members').upsert({
          organization_id,
          firebase_uid: firebaseUser?.uid || `fb_uid_${Date.now()}`,
          email: cleanEmail,
          full_name: display_name,
          role: 'ORG_ADMIN',
          status: 'ACTIVE',
        }, { onConflict: 'email' });
      } catch (dbErr) {
        console.warn('[SUPABASE] Failed to persist organization member:', dbErr);
      }
    }

    // 8. Record in Multi-Tenant Audit Log
    store.logAudit(
      authResult.user.email,
      'CREATE_ORG_ADMIN',
      'organization_members',
      newMember.id,
      {
        email: cleanEmail,
        organization_id,
        organization_name: org.name,
        initial_location_id: initial_location_id || null,
        contact_number: contact_number || null,
        created_by: authResult.user.email,
      },
      organization_id
    );

    return NextResponse.json({
      success: true,
      member: {
        id: newMember.id,
        email: newMember.email,
        full_name: newMember.full_name,
        role: newMember.role,
        organization_id: newMember.organization_id,
        organization_name: org.name,
        status: newMember.status,
      },
      temporary_password: temporaryPassword,
      message: `Organization Administrator created successfully for ${org.name}.`,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
