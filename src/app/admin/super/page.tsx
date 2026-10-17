'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Building2,
  Plus,
  ShieldCheck,
  Users,
  Activity,
  AlertTriangle,
  RefreshCw,
  Sliders,
  DollarSign,
  Printer,
  Monitor,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Lock,
} from 'lucide-react';
import { AdminAuthGuard } from '@/components/AdminAuthGuard';
import { Organization, OrganizationMember } from '@/lib/types';
import { auth } from '@/lib/firebase';

function SuperAdminContent({ currentUser }: { currentUser: { email: string; role: string; onLogout: () => void } }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // New Organization Form State
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formPublicUrl, setFormPublicUrl] = useState('');
  const [formAdminEmail, setFormAdminEmail] = useState('');
  const [formPrimaryColor, setFormPrimaryColor] = useState('#0d253f');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    try {
      const user = auth.currentUser;
      if (user) {
        const token = await user.getIdToken();
        return { Authorization: `Bearer ${token}` };
      }
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('smartprint_admin_token');
        if (stored) return { Authorization: `Bearer ${stored}` };
      }
    } catch (e) {
      console.warn('Failed to get Firebase token:', e);
    }
    return {};
  };

  const fetchSuperData = async () => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/organizations', {
        headers: { ...authHeaders },
      });
      const data = await res.json();
      if (data.organizations) setOrganizations(data.organizations);

      const dataRes = await fetch('/api/admin/data', {
        headers: { ...authHeaders },
      });
      const fullData = await dataRes.json();
      if (fullData.members) setMembers(fullData.members);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuperData();
  }, []);

  const showToastMsg = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/organizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          name: formName,
          slug: formSlug,
          public_url: formPublicUrl,
          admin_email: formAdminEmail,
          brand_colors: {
            primary: formPrimaryColor,
            secondary: '#1e40af',
            accent: '#ef4444',
            bg: '#ffffff',
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create organization');

      showToastMsg(`Organization '${formName}' created successfully!`);
      setShowCreateModal(false);
      setFormName('');
      setFormSlug('');
      setFormPublicUrl('');
      setFormAdminEmail('');
      fetchSuperData();
    } catch (err) {
      showToastMsg((err as Error).message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (org: Organization) => {
    const nextStatus = org.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/organizations', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          id: org.id,
          status: nextStatus,
        }),
      });
      if (res.ok) {
        showToastMsg(`Organization status updated to ${nextStatus}`);
        fetchSuperData();
      }
    } catch {
      showToastMsg('Failed to update organization status', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
      {/* Header */}
      <header className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-black text-white shadow-lg">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
              <span>GITAM SMARTPRINT</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/40 font-mono">
                SUPER ADMIN
              </span>
            </h1>
            <p className="text-xs text-slate-400 font-medium">Multi-Tenant Platform Control Plane</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700 transition"
          >
            Organization Console
          </Link>
          <button
            onClick={() => currentUser.onLogout()}
            className="px-3 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/60 text-xs font-bold text-red-300 border border-red-800/60 transition"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 px-4 py-2.5 rounded-xl shadow-xl text-xs font-bold border ${
            toast.type === 'success' ? 'bg-emerald-950 text-emerald-200 border-emerald-700' : 'bg-red-950 text-red-200 border-red-700'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Metric Bar */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-2xl space-y-1">
            <span className="text-xs font-bold text-slate-400 uppercase">Total Organizations</span>
            <div className="text-2xl font-black text-white">{organizations.length}</div>
            <span className="text-[11px] text-emerald-400 font-semibold">
              {organizations.filter((o) => o.status === 'ACTIVE').length} Active
            </span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-2xl space-y-1">
            <span className="text-xs font-bold text-slate-400 uppercase">Authorized Admins</span>
            <div className="text-2xl font-black text-white">{members.length}</div>
            <span className="text-[11px] text-blue-400 font-semibold">Across all tenants</span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-2xl space-y-1">
            <span className="text-xs font-bold text-slate-400 uppercase">Tenant Isolation</span>
            <div className="text-2xl font-black text-emerald-400 flex items-center gap-1.5">
              <ShieldCheck className="w-6 h-6" />
              <span>STRICT RLS</span>
            </div>
            <span className="text-[11px] text-slate-400 font-semibold">Zero cross-tenant bleed</span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-2xl space-y-1">
            <span className="text-xs font-bold text-slate-400 uppercase">Zero-Retention Storage</span>
            <div className="text-2xl font-black text-sky-400">ENFORCED</div>
            <span className="text-[11px] text-slate-400 font-semibold">Supabase Private Spool</span>
          </div>
        </div>

        {/* Organizations Section Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-white">Registered Organizations</h2>
            <p className="text-xs text-slate-400">Manage tenants, provision new colleges, and monitor isolated fleets.</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-900/30 flex items-center gap-1.5 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Create Organization</span>
          </button>
        </div>

        {/* Organizations Table */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-900/80 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-800 text-[11px]">
                <tr>
                  <th className="py-3 px-4">Organization Name</th>
                  <th className="py-3 px-4">Slug</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Public Route</th>
                  <th className="py-3 px-4">Brand Color</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {organizations.map((org) => (
                  <tr key={org.id} className="hover:bg-slate-900/40 transition">
                    <td className="py-3 px-4">
                      <div className="font-bold text-white text-sm">{org.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{org.id}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-blue-300 font-bold">{org.slug}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          org.status === 'ACTIVE'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        }`}
                      >
                        {org.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/print/${org.slug}`}
                        target="_blank"
                        className="text-blue-400 hover:underline flex items-center gap-1 text-[11px]"
                      >
                        <span>/print/{org.slug}</span>
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-4 h-4 rounded-full border border-slate-700 shadow"
                          style={{ backgroundColor: org.brand_colors?.primary || '#0d253f' }}
                        />
                        <span className="font-mono text-[11px] text-slate-300">
                          {org.brand_colors?.primary || '#0d253f'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <button
                        onClick={() => handleToggleStatus(org)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                          org.status === 'ACTIVE'
                            ? 'bg-amber-950/40 text-amber-300 border-amber-800/60 hover:bg-amber-900/60'
                            : 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/60'
                        }`}
                      >
                        {org.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                      </button>
                      <Link
                        href={`/admin?organization_id=${org.id}`}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-blue-950/60 text-blue-300 border border-blue-800/60 hover:bg-blue-900/60 transition"
                      >
                        Manage Fleet
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Create Organization Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-400" />
                <span>Onboard New Organization</span>
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateOrg} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">Organization Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SRM SMARTPRINT or APNA PRINT"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Unique Slug</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. srm-smartprint or apnaprint"
                  value={formSlug}
                  onChange={(e) => setFormSlug(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-blue-500 font-mono"
                />
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  Public Kiosk URL: /print/{formSlug || 'slug'}
                </span>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Organization Admin Email</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. admin@srm.edu"
                  value={formAdminEmail}
                  onChange={(e) => setFormAdminEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Primary Brand Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={formPrimaryColor}
                    onChange={(e) => setFormPrimaryColor(e.target.value)}
                    className="w-9 h-9 bg-transparent border-0 cursor-pointer rounded"
                  />
                  <input
                    type="text"
                    value={formPrimaryColor}
                    onChange={(e) => setFormPrimaryColor(e.target.value)}
                    className="flex-1 px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold flex items-center gap-2 shadow-lg shadow-blue-900/30"
                >
                  {isSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Initialize Tenant</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SuperAdminPage() {
  return (
    <AdminAuthGuard>
      {(currentUser) => <SuperAdminContent currentUser={currentUser} />}
    </AdminAuthGuard>
  );
}
