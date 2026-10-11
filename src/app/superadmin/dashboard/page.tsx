'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import {
  Building2,
  Plus,
  ShieldCheck,
  Users,
  Activity,
  AlertTriangle,
  RefreshCw,
  LogOut,
  Sliders,
  DollarSign,
  Printer,
  Monitor,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Lock,
  Key,
} from 'lucide-react';
import { Organization, OrganizationMember, Kiosk, Device, PrintJob, PaymentRecord, AuditLog } from '@/lib/types';

export default function SuperAdminDashboardPage() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [kiosks, setKiosks] = useState<Kiosk[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'organizations' | 'admins' | 'devices' | 'jobs' | 'payments' | 'audit'>('overview');

  // Modals
  const [showCreateOrgModal, setShowCreateOrgModal] = useState(false);
  const [showCreateAdminModal, setShowCreateAdminModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Create Org Form
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [orgUrl, setOrgUrl] = useState('');
  const [isSubmittingOrg, setIsSubmittingOrg] = useState(false);

  // Create Admin Form
  const [adminDisplayName, setAdminDisplayName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminOrgId, setAdminOrgId] = useState('');
  const [adminContact, setAdminContact] = useState('');
  const [createdAdminCreds, setCreatedAdminCreds] = useState<{ email: string; tempPass: string } | null>(null);
  const [isSubmittingAdmin, setIsSubmittingAdmin] = useState(false);

  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const getAuthToken = useCallback(async (): Promise<string | null> => {
    if (firebaseUser) {
      try {
        return await firebaseUser.getIdToken(false);
      } catch {
        return null;
      }
    }
    return null;
  }, [firebaseUser]);

  const fetchData = useCallback(async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        router.push('/superadmin/login');
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };

      const [orgsRes, dataRes] = await Promise.all([
        fetch('/api/admin/organizations', { headers }),
        fetch('/api/admin/data', { headers }),
      ]);

      if (orgsRes.status === 401 || dataRes.status === 401) {
        router.push('/superadmin/login');
        return;
      }

      const orgsData = await orgsRes.json();
      if (orgsData.organizations) setOrganizations(orgsData.organizations);

      const fullData = await dataRes.json();
      if (fullData.members) setMembers(fullData.members);
      if (fullData.kiosks) setKiosks(fullData.kiosks);
      if (fullData.devices) setDevices(fullData.devices);
      if (fullData.jobs) setJobs(fullData.jobs);
      if (fullData.payments) setPayments(fullData.payments);
      if (fullData.audit_logs) setAuditLogs(fullData.audit_logs);
    } catch (e) {
      console.error(e);
      showToast('Failed to load dashboard data', 'error');
    } finally {
      setLoading(false);
    }
  }, [getAuthToken, router]);

  // Watch Firebase auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthChecked(true);
      if (!user) {
        router.push('/superadmin/login');
      }
    });
    return () => unsubscribe();
  }, [router]);

  // Fetch data when user is authenticated
  useEffect(() => {
    let active = true;
    if (authChecked && firebaseUser) {
      void (async () => {
        if (active) {
          await fetchData();
        }
      })();
    }
    return () => {
      active = false;
    };
  }, [authChecked, firebaseUser, fetchData]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error('[AUTH] Logout error:', e);
    }
    router.push('/superadmin/login');
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingOrg(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        showToast('Authentication required', 'error');
        setIsSubmittingOrg(false);
        return;
      }
      const res = await fetch('/api/admin/organizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: orgName,
          slug: orgSlug,
          public_url: orgUrl,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Organization '${data.organization.name}' created!`);
        setShowCreateOrgModal(false);
        setOrgName('');
        setOrgSlug('');
        setOrgUrl('');
        fetchData();
      } else {
        showToast(data.error || 'Failed to create organization', 'error');
      }
    } catch {
      showToast('Network error creating organization', 'error');
    } finally {
      setIsSubmittingOrg(false);
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingAdmin(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        showToast('Authentication required', 'error');
        setIsSubmittingAdmin(false);
        return;
      }
      const res = await fetch('/api/admin/create-admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          display_name: adminDisplayName,
          email: adminEmail,
          organization_id: adminOrgId || (organizations[0]?.id || ''),
          contact_number: adminContact,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Admin account created for ${data.member.full_name}!`);
        setCreatedAdminCreds({
          email: data.member.email,
          tempPass: data.temporary_password,
        });
        setAdminDisplayName('');
        setAdminEmail('');
        setAdminContact('');
        fetchData();
      } else {
        showToast(data.error || 'Failed to create admin', 'error');
      }
    } catch {
      showToast('Network error creating admin', 'error');
    } finally {
      setIsSubmittingAdmin(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-12">
      {/* Header */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 font-bold">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-lg tracking-tight">GITAM SMARTPRINT</span>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-amber-500 text-slate-900">
                  Super Admin
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Platform Infrastructure & Multi-Tenant Control</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-300 font-mono">admin@gitam.edu</span>
            <button
              onClick={() => fetchData()}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            {[
              { id: 'overview', label: 'Platform Overview' },
              { id: 'organizations', label: `Organizations (${organizations.length})` },
              { id: 'admins', label: `Administrators (${members.length})` },
              { id: 'devices', label: `Edge Devices (${devices.length})` },
              { id: 'jobs', label: `Print Jobs (${jobs.length})` },
              { id: 'payments', label: `Transactions (${payments.length})` },
              { id: 'audit', label: 'Audit Logs' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTab === tab.id
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateAdminModal(true)}
              className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              Create Admin
            </button>
            <button
              onClick={() => setShowCreateOrgModal(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all"
            >
              <Building2 className="w-4 h-4" />
              New Organization
            </button>
          </div>
        </div>

        {/* Toast Alert */}
        {toast && (
          <div
            className={`p-3.5 rounded-xl text-xs font-semibold shadow-md flex items-center gap-2 ${
              toast.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-red-600" />}
            <span>{toast.message}</span>
          </div>
        )}

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Organizations</span>
                <span className="text-3xl font-black text-slate-900 mt-1 block">{organizations.length}</span>
                <span className="text-[11px] text-emerald-600 font-bold mt-1 block">Active Multi-Tenancy</span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Admins Enrolled</span>
                <span className="text-3xl font-black text-slate-900 mt-1 block">{members.length}</span>
                <span className="text-[11px] text-slate-500 font-medium mt-1 block">Role-isolated access</span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Active Kiosks</span>
                <span className="text-3xl font-black text-slate-900 mt-1 block">{kiosks.length}</span>
                <span className="text-[11px] text-emerald-600 font-bold mt-1 block">Autonomous monitor units</span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Total Print Jobs</span>
                <span className="text-3xl font-black text-slate-900 mt-1 block">{jobs.length}</span>
                <span className="text-[11px] text-slate-500 font-medium mt-1 block">Zero-Retention shredding</span>
              </div>
            </div>

            {/* Organizations Summary */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-amber-600" />
                <span>Managed Institutions & Brands</span>
              </h3>
              <div className="divide-y divide-slate-100">
                {organizations.map((org) => (
                  <div key={org.id} className="py-3 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-900 text-sm">{org.name}</span>
                      <span className="text-xs text-slate-500 block">Slug: /{org.slug} • Status: {org.status}</span>
                    </div>
                    <Link
                      href={`/admin/organization?slug=${org.slug}`}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1"
                    >
                      <span>Manage Org</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ORGANIZATIONS TAB */}
        {activeTab === 'organizations' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">All Organizations</h3>
              <button
                onClick={() => setShowCreateOrgModal(true)}
                className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Add Organization
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px]">
                    <th className="py-2.5 px-3">Organization Name</th>
                    <th className="py-2.5 px-3">Slug</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Created</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {organizations.map((org) => (
                    <tr key={org.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-3 font-bold text-slate-900">{org.name}</td>
                      <td className="py-3 px-3 font-mono text-slate-600">/{org.slug}</td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {org.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-500">{new Date(org.created_at).toLocaleDateString()}</td>
                      <td className="py-3 px-3 text-right">
                        <Link
                          href={`/admin/organization?slug=${org.slug}`}
                          className="text-amber-600 hover:underline font-bold"
                        >
                          Configure →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ADMINS TAB */}
        {activeTab === 'admins' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">Platform & Organization Administrators</h3>
              <button
                onClick={() => setShowCreateAdminModal(true)}
                className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Provision New Admin
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px]">
                    <th className="py-2.5 px-3">Administrator</th>
                    <th className="py-2.5 px-3">Email</th>
                    <th className="py-2.5 px-3">Role</th>
                    <th className="py-2.5 px-3">Assigned Organization</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {members.map((m) => {
                    const org = organizations.find((o) => o.id === m.organization_id);
                    return (
                      <tr key={m.id} className="hover:bg-slate-50/50">
                        <td className="py-3 px-3 font-bold text-slate-900">{m.full_name}</td>
                        <td className="py-3 px-3 font-mono text-slate-600">{m.email}</td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              m.role === 'SUPER_ADMIN'
                                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                : 'bg-blue-50 text-blue-700 border border-blue-200'
                            }`}
                          >
                            {m.role}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-700 font-medium">
                          {m.role === 'SUPER_ADMIN' ? 'All Organizations (Platform-wide)' : org?.name || m.organization_id}
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            {m.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* DEVICES TAB */}
        {activeTab === 'devices' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <h3 className="text-base font-black text-slate-900">Raspberry Pi Edge Controllers</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {devices.map((d) => (
                <div key={d.id} className="p-4 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-900 text-sm">{d.id}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {d.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 space-y-1">
                    <p>IP: {d.ip_address || '192.168.1.105'} • Agent: v{d.agent_version || '1.0.0'}</p>
                    <p>CPU Temp: {d.cpu_temp_celsius || 42.5}°C • RAM: {d.ram_usage_percent || 34.2}%</p>
                    <p>Assigned Kiosk: {d.kiosk_id}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AUDIT LOGS TAB */}
        {activeTab === 'audit' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <h3 className="text-base font-black text-slate-900">Platform Security Audit Log</h3>
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto text-xs">
              {auditLogs.map((log) => (
                <div key={log.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-900">{log.action}</span>
                    <span className="text-slate-500 block text-[11px]">
                      By {log.admin_email} on {log.target_type} ({log.target_id || 'global'})
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* CREATE ADMIN MODAL */}
      {showCreateAdminModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900">Provision Organization Administrator</h3>
              <button onClick={() => setShowCreateAdminModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            {createdAdminCreds ? (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 space-y-2">
                  <p className="font-black text-sm flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Admin Provisioned Successfully!
                  </p>
                  <p>Share these initial credentials securely with the administrator:</p>
                  <div className="p-3 bg-white rounded-xl border border-emerald-200 font-mono text-xs space-y-1">
                    <p>Email: <strong>{createdAdminCreds.email}</strong></p>
                    <p>Initial Password: <strong className="text-emerald-700">{createdAdminCreds.tempPass}</strong></p>
                  </div>
                  <p className="text-[11px] text-emerald-700">The administrator will sign in at: <strong>/admin/login</strong></p>
                </div>
                <button
                  onClick={() => {
                    setCreatedAdminCreds(null);
                    setShowCreateAdminModal(false);
                  }}
                  className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateAdmin} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Admin Display Name</label>
                  <input
                    type="text"
                    required
                    value={adminDisplayName}
                    onChange={(e) => setAdminDisplayName(e.target.value)}
                    placeholder="e.g. Ramesh Kumar"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Admin Email Address</label>
                  <input
                    type="email"
                    required
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="e.g. ramesh@gitam.edu"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Assigned Organization</label>
                  <select
                    value={adminOrgId}
                    onChange={(e) => setAdminOrgId(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500 outline-none"
                  >
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name} ({org.slug})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Contact Number (Optional)</label>
                  <input
                    type="text"
                    value={adminContact}
                    onChange={(e) => setAdminContact(e.target.value)}
                    placeholder="e.g. 9876543210"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500 outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setShowCreateAdminModal(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingAdmin}
                    className="px-4 py-2 text-xs font-bold bg-slate-900 text-white rounded-xl hover:bg-slate-800 disabled:opacity-50"
                  >
                    {isSubmittingAdmin ? 'Creating...' : 'Provision Admin'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* CREATE ORG MODAL */}
      {showCreateOrgModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900">Create New Organization</h3>
              <button onClick={() => setShowCreateOrgModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <form onSubmit={handleCreateOrg} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Organization Name</label>
                <input
                  type="text"
                  required
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="e.g. APNA SMART PRINTER"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Unique Slug</label>
                <input
                  type="text"
                  required
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="e.g. apna"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-mono focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Public Portal URL (Optional)</label>
                <input
                  type="url"
                  value={orgUrl}
                  onChange={(e) => setOrgUrl(e.target.value)}
                  placeholder="https://apnaprint.in"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateOrgModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingOrg}
                  className="px-4 py-2 text-xs font-bold bg-slate-900 text-white rounded-xl hover:bg-slate-800 disabled:opacity-50"
                >
                  {isSubmittingOrg ? 'Creating...' : 'Create Organization'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
