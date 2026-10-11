'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { ShieldCheck, Lock, Mail, AlertTriangle, ArrowRight } from 'lucide-react';

export default function SuperAdminLoginPage() {
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
      let idToken = '';
      const cred = await signInWithEmailAndPassword(auth, email, password);
      idToken = await cred.user.getIdToken();

      // Verify role with backend
      const res = await fetch('/api/admin/auth/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (!res.ok || !data.user) {
        throw new Error(data.error || 'Authentication failed');
      }

      if (!data.user.isSuperAdmin && data.user.role !== 'SUPER_ADMIN') {
        // Normal Admin cannot access Super Admin
        setError('Access Denied: Your account does not have Platform Super Admin authorization. Please use the Organization Admin portal.');
        return;
      }

      // Store token & redirect to Super Admin dashboard
      if (typeof window !== 'undefined') {
        localStorage.setItem('smartprint_admin_token', idToken);
        localStorage.setItem('smartprint_user_role', 'SUPER_ADMIN');
      }
      router.push('/superadmin/dashboard');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid Super Admin credentials.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-200 p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-600">
            <ShieldCheck className="w-9 h-9" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Platform Super Admin</h1>
          <p className="text-xs text-slate-500 font-medium">
            Dedicated infrastructure access for GITAM SMARTPRINT owner.
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
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Super Admin Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@gitam.edu"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Secure Password</label>
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
            className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
          >
            {loading ? 'Verifying Authorization...' : 'Sign In as Super Admin'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="pt-2 text-center border-t border-slate-100">
          <p className="text-xs text-slate-400">
            Organization Admin?{' '}
            <a href="/admin/login" className="text-amber-600 font-bold hover:underline">
              Go to Org Admin Portal →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
