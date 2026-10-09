import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function POST(request: Request) {
  try {
    const { email, uid } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Determine admin role based on email/UID mapping
    // Default system super admin: admin@gitam.edu
    let role = 'OPERATOR';
    if (email.toLowerCase().includes('admin') || email.toLowerCase() === 'admin@gitam.edu') {
      role = 'SUPER_ADMIN';
    }

    store.logAudit(email, 'LOGIN', 'admin_users', uid || 'firebase_user', {
      role,
      auth_provider: 'firebase',
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      user: {
        email,
        uid: uid || 'firebase_uid',
        role,
        permissions: role === 'SUPER_ADMIN' 
          ? ['all'] 
          : ['view_dashboard', 'view_kiosks', 'view_printers', 'view_jobs', 'trigger_test_print']
      }
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
