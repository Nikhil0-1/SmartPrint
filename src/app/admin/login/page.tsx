'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Printer, Lock, Mail, AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await cred.user.getIdToken();

      // Verify role & organization membership with backend
      const res = await fetch('/api/admin/auth/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ email }),
      });

      const text = await res.text();
      let data: { user?: { role: string; email: string; isSuperAdmin?: boolean; authorizedOrganizationIds?: string[] }; error?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`Authentication server returned error (${res.status}). Please try again.`);
      }

      if (!res.ok || !data.user) {
        throw new Error(data.error || 'Authentication failed');
      }

      // Store in localStorage for session persistence
      if (typeof window !== 'undefined') {
        localStorage.setItem('smartprint_admin_token', idToken);
        localStorage.setItem('smartprint_user_role', data.user.role);
        localStorage.setItem('smartprint_user_email', data.user.email);
        if (data.user.authorizedOrganizationIds?.[0]) {
          localStorage.setItem('smartprint_org_id', data.user.authorizedOrganizationIds[0]);
        }
      }

      if (data.user.isSuperAdmin || data.user.role === 'SUPER_ADMIN') {
        router.push('/superadmin/dashboard');
      } else {
        router.push('/admin/dashboard');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid administrator credentials.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-200 p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-amber-500 shadow-md">
            <Printer className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Organization Admin Portal</h1>
          <p className="text-xs text-slate-500 font-medium">
            Sign in to manage your printers, kiosks, pricing, and Razorpay payments.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Admin Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@gitam.edu or admin@apnaprint.in"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Sign In to Organization'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="pt-2 text-center border-t border-slate-100">
          <p className="text-xs text-slate-400">
            Platform Super Admin?{' '}
            <a href="/superadmin/login" className="text-slate-900 font-bold hover:underline">
              Go to Super Admin Portal →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
