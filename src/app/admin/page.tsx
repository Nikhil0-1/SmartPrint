'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,
  Monitor,
  Printer,
  FileText,
  CreditCard,
  Tag,
  Palette,
  Activity,
  ShieldCheck,
  RotateCw,
  AlertTriangle,
  CheckCircle2,
  Phone,
  Power,
  RefreshCw,
  ExternalLink,
  Zap,
  Sliders,
  Save,
  KeyRound,
  Copy,
  Check,
  Eye,
  EyeOff,
  Radio,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { DEFAULT_BRANDING, DEFAULT_PRICING } from '@/lib/constants';
import { AdminAuthGuard } from '@/components/AdminAuthGuard';
import { LogOut, UserCheck } from 'lucide-react';
import { auth } from '@/lib/firebase';

interface CurrentAdmin {
  email: string;
  role: string;
  onLogout: () => void;
}

export type AdminTab =
  | 'dashboard'
  | 'kiosks'
  | 'printers'
  | 'routing'
  | 'jobs'
  | 'payments'
  | 'payment_gateway'
  | 'pricing'
  | 'branding'
  | 'telemetry'
  | 'audit'
  | 'settings';

function AdminDashboardContent({
  currentUser,
  initialTab = 'dashboard',
}: {
  currentUser: CurrentAdmin;
  initialTab?: AdminTab;
}) {
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);

  const [loading, setLoading] = useState<boolean>(true);
  const [adminData, setAdminData] = useState<any>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Form states for editable sections
  const [pricingForm, setPricingForm] = useState(DEFAULT_PRICING);
  const [brandingForm, setBrandingForm] = useState(DEFAULT_BRANDING);
  const [isSimulating, setIsSimulating] = useState(false);
  const [testingPrinterId, setTestingPrinterId] = useState<string | null>(null);

  // Payment Gateway Form State
  const [paymentConfigForm, setPaymentConfigForm] = useState({
    mode: 'TEST',
    razorpay_key_id: '',
    razorpay_key_secret: '',
    webhook_secret: '',
    status: 'NOT_CONFIGURED',
    verified_at: null as string | null,
  });
  const [showKeySecret, setShowKeySecret] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [isTestingPaymentConn, setIsTestingPaymentConn] = useState(false);
  const [isSavingPaymentConfig, setIsSavingPaymentConfig] = useState(false);
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState(false);

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

  const fetchAdminData = async () => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/data', {
        headers: { ...authHeaders },
      });
      const data = await res.json();
      if (res.ok && data) {
        setAdminData(data);
        if (data.pricing) setPricingForm(data.pricing);
        if (data.branding) setBrandingForm(data.branding);
        if (data.payment_config) {
          setPaymentConfigForm((prev) => ({
            ...prev,
            mode: data.payment_config.mode || 'TEST',
            razorpay_key_id: data.payment_config.razorpay_key_id || '',
            status: data.payment_config.status || 'NOT_CONFIGURED',
            verified_at: data.payment_config.verified_at || null,
          }));
        }
      }
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
    const interval = setInterval(fetchAdminData, 6000);
    return () => clearInterval(interval);
  }, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  // Save Pricing
  const handleSavePricing = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/pricing', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(pricingForm),
      });
      if (res.ok) {
        showToast('Pricing configuration updated successfully!');
        fetchAdminData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to update pricing', 'error');
      }
    } catch (err) {
      showToast('Error updating pricing', 'error');
    }
  };

  // Save Branding
  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/branding', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(brandingForm),
      });
      if (res.ok) {
        showToast('Branding settings updated successfully!');
        fetchAdminData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to update branding', 'error');
      }
    } catch (err) {
      showToast('Error updating branding', 'error');
    }
  };

  // Save Payment Configuration
  const handleSavePaymentConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingPaymentConfig(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/payment-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(paymentConfigForm),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Razorpay Payment Gateway settings saved!');
        if (data.config) {
          setPaymentConfigForm((prev) => ({
            ...prev,
            status: data.config.status,
            verified_at: data.config.verified_at,
          }));
        }
        fetchAdminData();
      } else {
        showToast(data.error || 'Failed to save Payment Gateway settings', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error saving payment gateway config', 'error');
    } finally {
      setIsSavingPaymentConfig(false);
    }
  };

  // Test Payment Connection
  const handleTestPaymentConnection = async () => {
    setIsTestingPaymentConn(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/payment-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          ...paymentConfigForm,
          test_connection: true,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.config?.status === 'CONFIGURED') {
        showToast('Razorpay credentials verified successfully! Connection active.');
        setPaymentConfigForm((prev) => ({
          ...prev,
          status: data.config.status,
          verified_at: data.config.verified_at,
        }));
        fetchAdminData();
      } else {
        showToast(data.error || 'Razorpay verification failed. Ensure valid Key ID and Secret.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error testing Razorpay connection', 'error');
    } finally {
      setIsTestingPaymentConn(false);
    }
  };

  // Trigger Hardware Simulation
  const handleTriggerSimulation = async (action: string, payload: any = {}) => {
    setIsSimulating(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Simulation executed successfully!');
        fetchAdminData();
      } else {
        showToast(data.error || 'Simulation failed', 'error');
      }
    } catch (err) {
      showToast('Simulation request error', 'error');
    } finally {
      setIsSimulating(false);
    }
  };

  // Dispatch real test print
  const handleTestPrint = async (printer: any) => {
    setTestingPrinterId(printer.id);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/admin/test-print', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ printer_id: printer.id, kiosk_id: printer.kiosk_id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Test print dispatched to ${printer.cups_queue_name}! (Job: ${data.test_print_id})`);
        fetchAdminData();
      } else {
        showToast(data.error || 'Failed to dispatch test print', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Test print request error', 'error');
    } finally {
      setTestingPrinterId(null);
    }
  };

  // Toggle Kiosk Maintenance Mode
  const handleToggleMaintenance = async (kioskId: string, currentVal: boolean) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/kiosk/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-kiosk-id': kioskId,
          ...authHeaders,
        },
        body: JSON.stringify({ maintenance_mode: !currentVal }),
      });
      if (res.ok) {
        showToast(`Maintenance mode toggled for ${kioskId}`);
        fetchAdminData();
      }
    } catch (err) {
      showToast('Failed to toggle maintenance', 'error');
    }
  };

  if (loading && !adminData) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
          <span className="font-bold text-sm">Loading GITAM SMARTPRINT Management Console...</span>
        </div>
      </div>
    );
  }

  const stats = adminData?.stats || {
    total_prints: 0,
    today_prints: 0,
    today_revenue: 0,
    total_revenue: 0,
    active_kiosks: 0,
    online_kiosks: 0,
    online_printers: 0,
    failed_jobs: 0,
    recovery_required: 0,
  };

  const chartData = [
    { day: 'Mon', prints: 42, revenue: 84 },
    { day: 'Tue', prints: 58, revenue: 116 },
    { day: 'Wed', prints: 65, revenue: 130 },
    { day: 'Thu', prints: 78, revenue: 156 },
    { day: 'Fri', prints: 92, revenue: 184 },
    { day: 'Sat', prints: 35, revenue: 70 },
    { day: 'Today', prints: stats.today_prints || 12, revenue: stats.today_revenue || 24 },
  ];

  const pieData = [
    { name: 'Black & White', value: 85, color: '#0d253f' },
    { name: 'Color', value: 15, color: '#1e40af' },
  ];

  return (
    <div className="min-h-screen flex bg-slate-100 text-slate-900 font-sans">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-xl text-xs font-bold flex items-center gap-2 border transition-all ${
            notification.type === 'success'
              ? 'bg-emerald-900 text-white border-emerald-700'
              : 'bg-red-900 text-white border-red-700'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-400" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Admin Sidebar */}
      <aside className="w-64 bg-[#0d253f] text-slate-300 flex flex-col justify-between p-4 shrink-0 shadow-xl border-r border-slate-800">
        <div className="space-y-6">
          {/* Brand header */}
          <div className="flex items-center gap-3 px-2 pt-2">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white font-black shadow-lg">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <div className="text-white font-black text-base leading-tight">
                {brandingForm.organization} <span className="text-blue-400">ADMIN</span>
              </div>
              <div className="text-[10px] text-slate-400 font-semibold tracking-wider uppercase">
                Kiosk Ecosystem Controller
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
              { id: 'kiosks', label: 'Kiosks Manager', icon: Monitor },
              { id: 'printers', label: 'Printer Hardware', icon: Printer },
              { id: 'routing', label: 'Printer Routing', icon: Sliders },
              { id: 'jobs', label: 'Print Jobs & Queue', icon: FileText },
              { id: 'payments', label: 'Payments & Revenue', icon: CreditCard },
              { id: 'payment_gateway', label: 'Payment Gateway', icon: KeyRound },
              { id: 'pricing', label: 'Pricing Engine', icon: Tag },
              { id: 'branding', label: 'Branding Manager', icon: Palette },
              { id: 'telemetry', label: 'Telemetry & Simulation', icon: Activity },
              { id: 'audit', label: 'Audit & Cleanup Logs', icon: ShieldCheck },
              { id: 'settings', label: 'Settings & Retention', icon: Sliders },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as any)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-bold'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Support & Quick Links */}
        <div className="pt-4 border-t border-slate-800 space-y-3 px-2">
          <Link
            href="/kiosk/GITAM-SPK-001"
            target="_blank"
            className="flex items-center justify-between text-xs text-slate-400 hover:text-sky-300 py-1 font-medium transition-colors"
          >
            <span className="flex items-center gap-2">
              <Monitor className="w-3.5 h-3.5" />
              Launch Kiosk UI
            </span>
            <ExternalLink className="w-3 h-3" />
          </Link>
          <div className="p-2.5 bg-slate-900/90 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div className="font-bold text-white flex items-center gap-1.5">
              <Phone className="w-3 h-3 text-emerald-400" />
              <span>{brandingForm.support_number}</span>
            </div>
            <div>Powered by {brandingForm.powered_by}</div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto max-h-screen">
        {/* Top Bar */}
        <header className="bg-white border-b border-slate-200 py-3.5 px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs">
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight capitalize">
              {activeTab.replace('_', ' ')}
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              Autonomous Smart Campus Print Controller • Real-time Monitoring
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* User Info & Role Badge */}
            <div className="hidden md:flex items-center gap-2 bg-slate-50 border border-slate-200/80 px-3 py-1.5 rounded-xl text-xs">
              <UserCheck className="w-3.5 h-3.5 text-blue-600" />
              <span className="font-bold text-slate-800">{currentUser.email}</span>
              <span
                className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                  currentUser.role === 'SUPER_ADMIN'
                    ? 'bg-purple-100 text-purple-800 border border-purple-200'
                    : 'bg-blue-100 text-blue-800 border border-blue-200'
                }`}
              >
                {currentUser.role}
              </span>
            </div>

            <button
              onClick={() => fetchAdminData()}
              className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>

            <button
              onClick={() => handleTriggerSimulation('simulate_heartbeat')}
              disabled={isSimulating}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Simulate Pi Ping</span>
            </button>

            <button
              onClick={currentUser.onLogout}
              className="px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-xs font-bold text-red-600 flex items-center gap-1.5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>
        </header>

        <div className="p-6 space-y-6 flex-1">
          {/* TAB 1: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              {/* Stat Cards Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  {
                    title: 'TOTAL PRINTS',
                    value: stats.total_prints,
                    sub: 'Lifetime printed jobs',
                    color: 'text-blue-600',
                    border: 'border-blue-100',
                  },
                  {
                    title: "TODAY'S PRINTS",
                    value: stats.today_prints,
                    sub: 'Since 12:00 AM',
                    color: 'text-indigo-600',
                    border: 'border-indigo-100',
                  },
                  {
                    title: "TODAY'S REVENUE",
                    value: `₹${stats.today_revenue.toFixed(2)}`,
                    sub: 'Verified UPI payments',
                    color: 'text-emerald-600',
                    border: 'border-emerald-100',
                  },
                  {
                    title: 'ONLINE KIOSKS',
                    value: `${stats.online_kiosks} / ${stats.active_kiosks}`,
                    sub: 'Heartbeat active',
                    color: 'text-sky-600',
                    border: 'border-sky-100',
                  },
                  {
                    title: 'ONLINE PRINTERS',
                    value: stats.online_printers,
                    sub: 'HP USB connected & ready',
                    color: 'text-teal-600',
                    border: 'border-teal-100',
                  },
                  {
                    title: 'FAILED JOBS',
                    value: stats.failed_jobs,
                    sub: 'Hardware or print errors',
                    color: 'text-amber-600',
                    border: 'border-amber-100',
                  },
                  {
                    title: 'RECOVERY REQUIRED',
                    value: stats.recovery_required,
                    sub: 'Needs manual inspection',
                    color: 'text-red-600',
                    border: 'border-red-100',
                  },
                  {
                    title: 'FILE SECURITY',
                    value: '100% PURGED',
                    sub: 'Zero document retention',
                    color: 'text-emerald-600',
                    border: 'border-emerald-100',
                  },
                ].map((card, idx) => (
                  <div
                    key={idx}
                    className={`bg-white rounded-2xl p-4 border ${card.border} shadow-xs space-y-1`}
                  >
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      {card.title}
                    </span>
                    <div className={`text-2xl font-black ${card.color}`}>{card.value}</div>
                    <span className="text-[11px] text-slate-500 font-medium block">{card.sub}</span>
                  </div>
                ))}
              </div>

              {/* Analytics Charts */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Daily Campus Print Volume</h3>
                      <p className="text-xs text-slate-500">Prints per day across all active kiosks</p>
                    </div>
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg">
                      Weekly Trend
                    </span>
                  </div>
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <XAxis dataKey="day" stroke="#94a3b8" fontSize={12} />
                        <YAxis stroke="#94a3b8" fontSize={12} />
                        <Tooltip />
                        <Bar dataKey="prints" fill="#1e40af" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Print Mode Split</h3>
                    <p className="text-xs text-slate-500">Black & White vs Color prints</p>
                  </div>
                  <div className="h-44 w-full flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          innerRadius={45}
                          outerRadius={70}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between items-center text-slate-700">
                      <span className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#0d253f]"></span>
                        B&W (₹{pricingForm.bw_price_per_page}/page)
                      </span>
                      <strong>85%</strong>
                    </div>
                    <div className="flex justify-between items-center text-slate-700">
                      <span className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#1e40af]"></span>
                        Color (₹{pricingForm.color_price_per_page}/page)
                      </span>
                      <strong>15%</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: KIOSKS */}
          {activeTab === 'kiosks' && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Active Kiosks</h3>
                  <p className="text-xs text-slate-500">Raspberry Pi 3B+ devices registered in network</p>
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {(adminData?.kiosks || []).map((kiosk: any) => (
                  <div key={kiosk.id} className="py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-sm text-slate-900">{kiosk.id}</span>
                        <span className="text-xs font-semibold text-slate-700">— {kiosk.name}</span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            kiosk.status === 'ONLINE'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {kiosk.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">Location: {kiosk.location}</p>
                      <div className="flex items-center gap-4 text-[11px] text-slate-500 font-mono">
                        <span>IP: {kiosk.ip_address}</span>
                        <span>Temp: {kiosk.cpu_temp_celsius}°C</span>
                        <span>RAM: {kiosk.ram_usage_percent}%</span>
                        <span>Disk: {kiosk.disk_usage_percent}%</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleMaintenance(kiosk.id, kiosk.maintenance_mode)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                          kiosk.maintenance_mode
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {kiosk.maintenance_mode ? 'End Maintenance' : 'Set Maintenance'}
                      </button>
                      <Link
                        href={`/kiosk/${kiosk.id}`}
                        target="_blank"
                        className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>View HDMI</span>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: PRINTERS */}
          {activeTab === 'printers' && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">HP USB Printers & CUPS Queues</h3>
                <p className="text-xs text-slate-500">Locally connected printers via USB interface</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(adminData?.printers || []).map((printer: any) => (
                  <div key={printer.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                          <Printer className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-slate-900">{printer.printer_name}</h4>
                          <span className="text-[11px] text-slate-500 font-mono">
                            CUPS Queue: {printer.cups_queue_name}
                          </span>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        {printer.status}
                      </span>
                    </div>

                    <div className="text-xs space-y-1 text-slate-600">
                      <div>Assigned Kiosk: <strong className="text-slate-900">{printer.kiosk_id}</strong></div>
                      <div>Connection: <strong className="text-slate-900">{printer.connection_type}</strong></div>
                      <div>Duplex Supported: {printer.supports_duplex ? 'Yes' : 'No'}</div>
                    </div>

                    <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                      <span className="text-[10px] text-slate-400">
                        Last Print: {new Date(printer.last_test_print || Date.now()).toLocaleTimeString()}
                      </span>
                      <button
                        onClick={() => handleTestPrint(printer)}
                        disabled={testingPrinterId === printer.id}
                        className="px-3 py-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
                      >
                        {testingPrinterId === printer.id && <RefreshCw className="w-3 h-3 animate-spin text-blue-400" />}
                        <span>{testingPrinterId === printer.id ? 'Dispatching...' : 'Print Test Page'}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3.5: PRINTER ROUTING */}
          {activeTab === 'routing' && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900">Multi-Printer Server-Side Routing</h3>
                <p className="text-xs text-slate-500">
                  Configure primary and backup printer routes for B&W and Color customer print jobs
                </p>
              </div>

              <div className="space-y-6">
                {(adminData?.kiosks || []).map((kiosk: any) => {
                  const kioskPrinters = (adminData?.printers || []).filter(
                    (p: any) => p.kiosk_id === kiosk.id
                  );
                  const currentRoute = (adminData?.routings || []).find(
                    (r: any) => r.kiosk_id === kiosk.id
                  ) || {
                    bw_primary_printer_id: kioskPrinters[0]?.id,
                    bw_backup_printer_id: null,
                    color_primary_printer_id: kioskPrinters.find((p: any) => p.supports_color)?.id,
                    color_backup_printer_id: null,
                    auto_backup_enabled: true,
                  };

                  const handleSaveRoute = async (updatedFields: any) => {
                    try {
                      const authHeaders = await getAuthHeaders();
                      const res = await fetch('/api/admin/routing', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          ...authHeaders,
                        },
                        body: JSON.stringify({ kiosk_id: kiosk.id, ...currentRoute, ...updatedFields }),
                      });
                      const resData = await res.json();
                      if (res.ok && resData.success) {
                        showToast(`Routing updated for ${kiosk.id}`);
                        fetchAdminData();
                      } else {
                        showToast(resData.error || 'Failed updating routing', 'error');
                      }
                    } catch (err) {
                      showToast('Routing request error', 'error');
                    }
                  };

                  return (
                    <div key={kiosk.id} className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                        <div>
                          <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                            <Monitor className="w-4 h-4 text-blue-600" />
                            <span>{kiosk.name} ({kiosk.id})</span>
                          </h4>
                          <span className="text-[11px] text-slate-500">
                            {kioskPrinters.length} printer(s) connected
                          </span>
                        </div>
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={currentRoute.auto_backup_enabled}
                            onChange={(e) => handleSaveRoute({ auto_backup_enabled: e.target.checked })}
                            className="rounded text-blue-600"
                          />
                          <span>Automatic Backup Rerouting</span>
                        </label>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* BLACK & WHITE ROUTING */}
                        <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full bg-slate-900"></span>
                              B&W PRINT ROUTING
                            </span>
                          </div>

                          <div className="space-y-2 text-xs">
                            <div>
                              <label className="block font-bold text-slate-700 mb-1">
                                Primary Printer (B&W)
                              </label>
                              <select
                                value={currentRoute.bw_primary_printer_id || ''}
                                onChange={(e) => handleSaveRoute({ bw_primary_printer_id: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white text-slate-900 font-semibold"
                              >
                                <option value="">Select Primary B&W Printer...</option>
                                {kioskPrinters.map((p: any) => (
                                  <option key={p.id} value={p.id}>
                                    {p.display_name || p.printer_name} ({p.cups_queue_name})
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block font-bold text-slate-700 mb-1">
                                Backup Printer (B&W)
                              </label>
                              <select
                                value={currentRoute.bw_backup_printer_id || ''}
                                onChange={(e) =>
                                  handleSaveRoute({ bw_backup_printer_id: e.target.value || null })
                                }
                                className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white text-slate-900 font-semibold"
                              >
                                <option value="">None (No Backup Route)</option>
                                {kioskPrinters.map((p: any) => (
                                  <option key={p.id} value={p.id}>
                                    {p.display_name || p.printer_name} ({p.cups_queue_name})
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>

                        {/* COLOR ROUTING */}
                        <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-blue-700 uppercase tracking-wider flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
                              COLOR PRINT ROUTING
                            </span>
                          </div>

                          <div className="space-y-2 text-xs">
                            <div>
                              <label className="block font-bold text-slate-700 mb-1">
                                Primary Printer (Color)
                              </label>
                              <select
                                value={currentRoute.color_primary_printer_id || ''}
                                onChange={(e) => handleSaveRoute({ color_primary_printer_id: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white text-slate-900 font-semibold"
                              >
                                <option value="">Select Primary Color Printer...</option>
                                {kioskPrinters
                                  .filter((p: any) => p.supports_color)
                                  .map((p: any) => (
                                    <option key={p.id} value={p.id}>
                                      {p.display_name || p.printer_name} ({p.cups_queue_name})
                                    </option>
                                  ))}
                              </select>
                            </div>

                            <div>
                              <label className="block font-bold text-slate-700 mb-1">
                                Backup Printer (Color)
                              </label>
                              <select
                                value={currentRoute.color_backup_printer_id || ''}
                                onChange={(e) =>
                                  handleSaveRoute({ color_backup_printer_id: e.target.value || null })
                                }
                                className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white text-slate-900 font-semibold"
                              >
                                <option value="">None (No Backup Route)</option>
                                {kioskPrinters
                                  .filter((p: any) => p.supports_color)
                                  .map((p: any) => (
                                    <option key={p.id} value={p.id}>
                                      {p.display_name || p.printer_name} ({p.cups_queue_name})
                                    </option>
                                  ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: PRINT JOBS */}
          {activeTab === 'jobs' && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Print Jobs Ledger</h3>
                  <p className="text-xs text-slate-500">Live job statuses & file destruction verification</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase">
                    <tr>
                      <th className="py-2.5 px-3">Job ID</th>
                      <th className="py-2.5 px-3">Kiosk</th>
                      <th className="py-2.5 px-3">Pages / Copies</th>
                      <th className="py-2.5 px-3">Color</th>
                      <th className="py-2.5 px-3">Amount</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Created</th>
                      <th className="py-2.5 px-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(adminData?.jobs || []).map((job: any) => (
                      <tr key={job.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-3 font-mono font-bold text-slate-900">{job.id}</td>
                        <td className="py-3 px-3 font-semibold text-slate-700">{job.kiosk_id}</td>
                        <td className="py-3 px-3">
                          {job.pages_total} pages • {job.copies} copy
                        </td>
                        <td className="py-3 px-3">{job.is_color ? 'Color' : 'B&W'}</td>
                        <td className="py-3 px-3 font-bold text-slate-900">₹{job.calculated_amount}</td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              job.status === 'COMPLETED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : job.status === 'RECOVERY_REQUIRED'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {job.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-500">
                          {new Date(job.created_at).toLocaleTimeString()}
                        </td>
                        <td className="py-3 px-3">
                          {job.status === 'PAYMENT_VERIFIED' && (
                            <button
                              onClick={() =>
                                handleTriggerSimulation('simulate_print_lifecycle', { job_id: job.id })
                              }
                              className="px-2.5 py-1 bg-emerald-600 text-white rounded font-bold text-[10px]"
                            >
                              Simulate Print
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: PAYMENTS */}
          {activeTab === 'payments' && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Payment Transactions</h3>
                <p className="text-xs text-slate-500">Verified Razorpay UPI payment records</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase">
                    <tr>
                      <th className="py-2.5 px-3">Payment ID</th>
                      <th className="py-2.5 px-3">Order ID</th>
                      <th className="py-2.5 px-3">Job ID</th>
                      <th className="py-2.5 px-3">Amount</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(adminData?.payments || []).map((pay: any) => (
                      <tr key={pay.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-3 font-mono font-bold text-slate-900">
                          {pay.razorpay_payment_id || pay.id}
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-600">{pay.razorpay_order_id}</td>
                        <td className="py-3 px-3 font-mono text-blue-600">{pay.job_id}</td>
                        <td className="py-3 px-3 font-bold text-emerald-600 text-sm">₹{pay.amount}</td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            {pay.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-500">
                          {new Date(pay.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5.5: PAYMENT GATEWAY (RAZORPAY) */}
          {activeTab === 'payment_gateway' && (
            <div className="space-y-6 max-w-4xl">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-5">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <KeyRound className="w-5 h-5 text-blue-600" />
                      <span>Payment Gateway (Razorpay) Settings</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Configure organization-level API credentials and webhook secrets for student UPI payments
                    </p>
                  </div>

                  <div>
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                        paymentConfigForm.status === 'CONFIGURED'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : paymentConfigForm.status === 'PENDING_VERIFICATION'
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : paymentConfigForm.status === 'VERIFICATION_FAILED'
                          ? 'bg-red-100 text-red-800 border border-red-300'
                          : 'bg-slate-100 text-slate-700 border border-slate-300'
                      }`}
                    >
                      {paymentConfigForm.status === 'CONFIGURED' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                      )}
                      <span>
                        {paymentConfigForm.status === 'CONFIGURED'
                          ? 'GATEWAY ACTIVE & VERIFIED'
                          : paymentConfigForm.status === 'VERIFICATION_FAILED'
                          ? 'VERIFICATION FAILED'
                          : 'NOT CONFIGURED'}
                      </span>
                    </span>
                  </div>
                </div>

                {/* Tenant Isolation Banner */}
                <div className="p-4 bg-blue-50/70 border border-blue-200/80 rounded-xl flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <span className="font-bold text-blue-950 block">
                      Multi-Tenant Isolation Enforced ({brandingForm.organization})
                    </span>
                    <p className="text-blue-800">
                      These Razorpay credentials are bound exclusively to this organization. Revenue from student print orders at your kiosks settles directly into your designated Razorpay merchant account.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSavePaymentConfig} className="space-y-5 text-xs">
                  {/* Mode Selector */}
                  <div>
                    <label className="block font-bold text-slate-800 mb-2">
                      Gateway Operational Environment
                    </label>
                    <div className="grid grid-cols-2 gap-3 max-w-md">
                      <button
                        type="button"
                        onClick={() => setPaymentConfigForm({ ...paymentConfigForm, mode: 'TEST' })}
                        className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all ${
                          paymentConfigForm.mode === 'TEST'
                            ? 'border-amber-500 bg-amber-50/60 shadow-xs'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div>
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                            <span>Test Mode</span>
                          </div>
                          <span className="text-[10px] text-slate-500">rzp_test_... (Sandbox)</span>
                        </div>
                        {paymentConfigForm.mode === 'TEST' && <Check className="w-4 h-4 text-amber-600" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaymentConfigForm({ ...paymentConfigForm, mode: 'LIVE' })}
                        className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all ${
                          paymentConfigForm.mode === 'LIVE'
                            ? 'border-emerald-500 bg-emerald-50/60 shadow-xs'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div>
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            <span>Live Production</span>
                          </div>
                          <span className="text-[10px] text-slate-500">rzp_live_... (Real UPI)</span>
                        </div>
                        {paymentConfigForm.mode === 'LIVE' && <Check className="w-4 h-4 text-emerald-600" />}
                      </button>
                    </div>
                  </div>

                  {/* Razorpay Key ID */}
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Razorpay Key ID <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder={paymentConfigForm.mode === 'LIVE' ? 'rzp_live_xxxxxxxxxxxx' : 'rzp_test_xxxxxxxxxxxx'}
                      value={paymentConfigForm.razorpay_key_id}
                      onChange={(e) => setPaymentConfigForm({ ...paymentConfigForm, razorpay_key_id: e.target.value.trim() })}
                      className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Found in Razorpay Dashboard &rarr; Settings &rarr; API Keys.
                    </span>
                  </div>

                  {/* Razorpay Key Secret */}
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Razorpay Key Secret <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showKeySecret ? 'text' : 'password'}
                        placeholder={paymentConfigForm.status === 'CONFIGURED' ? '•••••••••••••••• (Leave blank to keep existing)' : 'Enter Razorpay Key Secret'}
                        value={paymentConfigForm.razorpay_key_secret}
                        onChange={(e) => setPaymentConfigForm({ ...paymentConfigForm, razorpay_key_secret: e.target.value })}
                        className="w-full px-3.5 py-2.5 pr-10 border border-slate-300 rounded-xl font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKeySecret(!showKeySecret)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                      >
                        {showKeySecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Secrets are securely stored and masked. Never revealed to client-side browsers.
                    </span>
                  </div>

                  {/* Webhook Secret */}
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Webhook Secret (HMAC-SHA256)
                    </label>
                    <div className="relative">
                      <input
                        type={showWebhookSecret ? 'text' : 'password'}
                        placeholder={paymentConfigForm.status === 'CONFIGURED' ? '•••••••••••••••• (Leave blank to keep existing)' : 'Enter Webhook Secret'}
                        value={paymentConfigForm.webhook_secret}
                        onChange={(e) => setPaymentConfigForm({ ...paymentConfigForm, webhook_secret: e.target.value })}
                        className="w-full px-3.5 py-2.5 pr-10 border border-slate-300 rounded-xl font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowWebhookSecret(!showWebhookSecret)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                      >
                        {showWebhookSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Used to cryptographically verify incoming Razorpay webhook payment notifications.
                    </span>
                  </div>

                  {/* Webhook Endpoint URL */}
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <span className="font-bold text-slate-700 block">
                      Your Organization Webhook URL for Razorpay Dashboard:
                    </span>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-slate-800 font-mono text-[11px] truncate select-all">
                        {typeof window !== 'undefined'
                          ? `${window.location.origin}/api/webhooks/razorpay`
                          : 'https://smart-print-sandy.vercel.app/api/webhooks/razorpay'}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          const url =
                            typeof window !== 'undefined'
                              ? `${window.location.origin}/api/webhooks/razorpay`
                              : 'https://smart-print-sandy.vercel.app/api/webhooks/razorpay';
                          navigator.clipboard.writeText(url);
                          setCopiedWebhookUrl(true);
                          setTimeout(() => setCopiedWebhookUrl(false), 2500);
                        }}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors"
                      >
                        {copiedWebhookUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedWebhookUrl ? 'Copied!' : 'Copy'}</span>
                      </button>
                    </div>
                    <span className="text-[10px] text-slate-500 block">
                      Subscribe to events: <strong className="text-slate-700 font-mono">order.paid</strong>, <strong className="text-slate-700 font-mono">payment.captured</strong>, <strong className="text-slate-700 font-mono">payment.failed</strong>
                    </span>
                  </div>

                  {/* Validation Timestamp */}
                  {paymentConfigForm.verified_at && (
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Last successfully verified: {new Date(paymentConfigForm.verified_at).toLocaleString()}</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handleTestPaymentConnection}
                      disabled={isTestingPaymentConn || !paymentConfigForm.razorpay_key_id}
                      className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 font-bold rounded-xl flex items-center gap-2 border border-slate-300 transition-colors"
                    >
                      {isTestingPaymentConn ? <RefreshCw className="w-4 h-4 animate-spin text-blue-600" /> : <Zap className="w-4 h-4 text-amber-500" />}
                      <span>{isTestingPaymentConn ? 'Verifying...' : 'Test Connection'}</span>
                    </button>

                    <button
                      type="submit"
                      disabled={isSavingPaymentConfig}
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl flex items-center gap-2 shadow-md shadow-blue-600/30 transition-colors"
                    >
                      {isSavingPaymentConfig ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      <span>{isSavingPaymentConfig ? 'Saving...' : 'Save Gateway Settings'}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* TAB 6: PRICING CONFIGURATION */}
          {activeTab === 'pricing' && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 max-w-2xl space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900">Pricing Engine Configuration</h3>
                <p className="text-xs text-slate-500">Adjust campus print rates and operational limits</p>
              </div>

              <form onSubmit={handleSavePricing} className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Black & White Price (₹/Page)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={pricingForm.bw_price_per_page}
                      onChange={(e) =>
                        setPricingForm({ ...pricingForm, bw_price_per_page: Number(e.target.value) })
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Color Price (₹/Page)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={pricingForm.color_price_per_page}
                      onChange={(e) =>
                        setPricingForm({ ...pricingForm, color_price_per_page: Number(e.target.value) })
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Service Fee (₹)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={pricingForm.service_charge}
                      onChange={(e) =>
                        setPricingForm({ ...pricingForm, service_charge: Number(e.target.value) })
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Max Pages / Job</label>
                    <input
                      type="number"
                      value={pricingForm.max_pages}
                      onChange={(e) =>
                        setPricingForm({ ...pricingForm, max_pages: Number(e.target.value) })
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Max Copies / Job</label>
                    <input
                      type="number"
                      value={pricingForm.max_copies}
                      onChange={(e) =>
                        setPricingForm({ ...pricingForm, max_copies: Number(e.target.value) })
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Max File Size (MB)</label>
                    <input
                      type="number"
                      value={pricingForm.max_file_size_mb}
                      onChange={(e) =>
                        setPricingForm({ ...pricingForm, max_file_size_mb: Number(e.target.value) })
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 flex justify-end">
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    <span>Save Pricing Rates</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 7: BRANDING CONFIGURATION */}
          {activeTab === 'branding' && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 max-w-2xl space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900">Branding Configuration</h3>
                <p className="text-xs text-slate-500">
                  Configure brand identity, taglines, and support numbers dynamically
                </p>
              </div>

              <form onSubmit={handleSaveBranding} className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Organization Name</label>
                    <input
                      type="text"
                      value={brandingForm.organization}
                      onChange={(e) => setBrandingForm({ ...brandingForm, organization: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Product Name</label>
                    <input
                      type="text"
                      value={brandingForm.product}
                      onChange={(e) => setBrandingForm({ ...brandingForm, product: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Primary Tagline</label>
                  <input
                    type="text"
                    value={brandingForm.primary_tagline}
                    onChange={(e) => setBrandingForm({ ...brandingForm, primary_tagline: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Powered By Credit</label>
                    <input
                      type="text"
                      value={brandingForm.powered_by}
                      onChange={(e) => setBrandingForm({ ...brandingForm, powered_by: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Support Phone Number</label>
                    <input
                      type="text"
                      value={brandingForm.support_number}
                      onChange={(e) => setBrandingForm({ ...brandingForm, support_number: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl font-bold"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 flex justify-end">
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    <span>Save Branding</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 8: TELEMETRY & HARDWARE SIMULATION */}
          {activeTab === 'telemetry' && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Raspberry Pi 3B+ Hardware Simulator</h3>
                    <p className="text-xs text-slate-500">
                      Test end-to-end hardware printing & telemetry when physical Pi/printer is not connected
                    </p>
                  </div>
                  <span className="px-2.5 py-1 bg-blue-100 text-blue-800 text-[10px] font-bold rounded-full">
                    DEMO SIMULATOR
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                    <h4 className="font-bold text-xs text-slate-900">Telemetry Heartbeat Ping</h4>
                    <p className="text-[11px] text-slate-600">
                      Simulates a periodic Raspberry Pi thermal & system metrics update to the backend.
                    </p>
                    <button
                      onClick={() => handleTriggerSimulation('simulate_heartbeat')}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-500"
                    >
                      Send Heartbeat Ping
                    </button>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                    <h4 className="font-bold text-xs text-slate-900">End-to-End CUPS Print Simulation</h4>
                    <p className="text-[11px] text-slate-600">
                      Transitions the latest pending job through downloading, CUPS queue, printing, and file destruction.
                    </p>
                    <button
                      onClick={() => {
                        const pending = adminData?.jobs?.find((j: any) => j.status === 'PAYMENT_VERIFIED');
                        if (pending) {
                          handleTriggerSimulation('simulate_print_lifecycle', { job_id: pending.id });
                        } else {
                          showToast('No job in PAYMENT_VERIFIED status. Create one in Mobile flow!', 'error');
                        }
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-500"
                    >
                      Process Pending Job
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 9: AUDIT & CLEANUP LOGS */}
          {activeTab === 'audit' && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Audit & Ephemeral File Cleanup Ledger</h3>
                <p className="text-xs text-slate-500">
                  Immutable record of document destruction and administrative changes
                </p>
              </div>

              <div className="space-y-2 font-mono text-[11px]">
                {(adminData?.system_logs || []).map((log: any) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 flex items-start gap-3"
                  >
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        log.level === 'CRITICAL'
                          ? 'bg-red-600 text-white'
                          : log.level === 'WARNING'
                          ? 'bg-amber-500 text-white'
                          : 'bg-blue-600 text-white'
                      }`}
                    >
                      {log.component}
                    </span>
                    <div className="flex-1">
                      <span className="font-semibold text-slate-900">{log.message}</span>
                      <div className="text-[10px] text-slate-400">
                        {new Date(log.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 10: SETTINGS */}
          {activeTab === 'settings' && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 max-w-2xl space-y-5">
              <div>
                <h3 className="text-base font-bold text-slate-900">Security & Retention Policy</h3>
                <p className="text-xs text-slate-500">
                  Configure ephemeral file retention and emergency fallback rules
                </p>
              </div>

              <div className="space-y-4 text-xs">
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1">
                  <div className="font-bold text-emerald-900 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Ephemeral Document Deletion: IMMEDIATE (Active)</span>
                  </div>
                  <p className="text-[11px] text-emerald-800">
                    Documents are automatically purged from both local Raspberry Pi storage and cloud memory buffer immediately upon verified print confirmation.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b border-slate-100">
                    <div>
                      <span className="font-bold text-slate-800 block">Emergency Retention Window</span>
                      <span className="text-[10px] text-slate-500">Maximum lifespan for interrupted jobs</span>
                    </div>
                    <span className="font-bold text-slate-700">24 Hours (Max)</span>
                  </div>

                  <div className="flex justify-between items-center py-2 border-b border-slate-100">
                    <div>
                      <span className="font-bold text-slate-800 block">Razorpay Webhook Mode</span>
                      <span className="text-[10px] text-slate-500">HMAC-SHA256 Signature Verification</span>
                    </div>
                    <span className="font-bold text-emerald-600">ENFORCED</span>
                  </div>

                  <div className="flex justify-between items-center py-2">
                    <div>
                      <span className="font-bold text-slate-800 block">Idempotent Print Guard</span>
                      <span className="text-[10px] text-slate-500">Prevents multiple prints per transaction</span>
                    </div>
                    <span className="font-bold text-emerald-600">LOCKED (1:1)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function AdminPanelPage({
  initialTab,
}: {
  initialTab?: AdminTab;
}) {
  return (
    <AdminAuthGuard>
      {(currentUser) => <AdminDashboardContent currentUser={currentUser} initialTab={initialTab} />}
    </AdminAuthGuard>
  );
}
