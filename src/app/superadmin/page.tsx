'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SuperAdminRedirect() {
  const router = useRouter();

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('smartprint_admin_token') : null;
    const role = typeof window !== 'undefined' ? localStorage.getItem('smartprint_user_role') : null;

    if (token && role === 'SUPER_ADMIN') {
      router.replace('/superadmin/dashboard');
    } else {
      router.replace('/superadmin/login');
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center font-sans text-xs font-bold text-slate-500">
      Loading Super Admin...
    </div>
  );
}
