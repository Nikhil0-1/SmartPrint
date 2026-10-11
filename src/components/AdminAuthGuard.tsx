'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import {
  Lock,
  Mail,
  Key,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  Printer,
} from 'lucide-react';

interface AdminAuthGuardProps {
  children: (user: { email: string; role: string; onLogout: () => void }) => React.ReactNode;
  requiredRole?: 'SUPER_ADMIN' | 'ORG_ADMIN' | 'any';
}

interface VerifiedSession {
  email: string;
  role: string;
  isSuperAdmin: boolean;
  fullName: string;
}

export function AdminAuthGuard({ children, requiredRole = 'any' }: AdminAuthGuardProps) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [session, setSession] = useState<VerifiedSession | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const verifySessionWithBackend = useCallback(async (fbUser: User): Promise<VerifiedSession | null> => {
    try {
      const idToken = await fbUser.getIdToken(false);
      const res = await fetch('/api/admin/auth/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ email: fbUser.email }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.warn('[AUTH] Backend verification rejected:', data.error);
        return null;
      }

      const data = await res.json();
      if (!data.user) return null;

      return {
        email: data.user.email,
        role: data.user.role,
        isSuperAdmin: data.user.isSuperAdmin,
        fullName: data.user.fullName,
      };
    } catch (e) {
      console.error('[AUTH] Backend verification error:', e);
      return null;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setLoading(true);
      if (currentUser) {
        const verified = await verifySessionWithBackend(currentUser);
        if (verified) {
          if (requiredRole === 'SUPER_ADMIN' && !verified.isSuperAdmin) {
            setAuthError('Access denied: Super Admin role required for this area.');
            setFirebaseUser(null);
            setSession(null);
            await signOut(auth);
          } else {
            setFirebaseUser(currentUser);
            setSession(verified);
            setAuthError('');
          }
        } else {
          setFirebaseUser(null);
          setSession(null);
          setAuthError('Your account is not authorized as an administrator. Contact platform support.');
          await signOut(auth);
        }
      } else {
        setFirebaseUser(null);
        setSession(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [verifySessionWithBackend, requiredRole]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setIsSubmitting(true);
    setAuthError('');

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // onAuthStateChanged handles the rest
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setAuthError('Invalid email or password.');
      } else if (code === 'auth/too-many-requests') {
        setAuthError('Too many failed attempts. Please wait a few minutes before trying again.');
      } else if (code === 'auth/user-disabled') {
        setAuthError('This account has been disabled. Contact your administrator.');
      } else if (code === 'auth/network-request-failed') {
        setAuthError('Network error. Please check your connection.');
      } else {
        setAuthError('Authentication failed. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error('[AUTH] Logout error:', e);
    }
    setFirebaseUser(null);
    setSession(null);
    setAuthError('');
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-900 text-white font-sans">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
          <span className="text-sm font-semibold text-slate-300">Verifying session...</span>
        </div>
      </div>
    );
  }

  if (firebaseUser && session) {
    return <>{children({ email: session.email, role: session.role, onLogout: handleLogout })}</>;
  }

  return (
    <div className="min-h-screen w-screen flex flex-col justify-center items-center bg-gradient-to-b from-[#0d253f] via-[#0f2d4e] to-slate-950 p-4 font-sans text-slate-900">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200/80 p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-2xl bg-[#0d253f] text-white flex items-center justify-center mx-auto shadow-lg shadow-blue-900/30">
            <Printer className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">GITAM SMARTPRINT</h1>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-blue-600" />
            <span>Admin Console</span>
          </p>
          <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-full">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Secured via Firebase Authentication</span>
          </div>
        </div>

        {authError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{authError}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-700 font-bold mb-1.5 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-slate-400" />
              <span>Admin Email</span>
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@gitam.edu"
              autoComplete="email"
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-blue-600 text-slate-900 font-medium"
            />
          </div>

          <div>
            <label className="block text-slate-700 font-bold mb-1.5 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-slate-400" />
              <span>Password</span>
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-blue-600 text-slate-900 font-medium"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 bg-[#0d253f] hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-950/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Lock className="w-4 h-4" />
            )}
            <span>{isSubmitting ? 'Signing in...' : 'Sign In with Firebase'}</span>
          </button>
        </form>

        <div className="text-center text-[11px] text-slate-400">
          Forgot your password? Contact your platform administrator.
        </div>
      </div>

      <div className="mt-6 text-center text-xs text-slate-400 font-medium">
        <span>GITAM SMARTPRINT • Powered by Nikhil • Support: 9006496970</span>
      </div>
    </div>
  );
}
