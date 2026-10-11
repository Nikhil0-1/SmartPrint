'use client';

import React, { useState, useEffect, use, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Printer,
  Wifi,
  ShieldCheck,
  Phone,
  Clock,
  Sparkles,
  CreditCard,
  FileCheck2,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Check,
  FileText,
  HelpCircle,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { KioskMonitorState } from '@/lib/types';

interface KioskStatusData {
  kiosk: {
    id: string;
    name: string;
    location: string;
    status: string;
    maintenance_mode: boolean;
    permanent_qr_url: string;
    active_job_id: string | null;
  };
  monitor_state: KioskMonitorState;
  sub_message?: string;
  active_job: {
    masked_id: string;
    status: string;
    pages_total: number;
    copies: number;
    is_color: boolean;
    is_duplex: boolean;
    paper_size: string;
    created_at: string;
    completed_at?: string;
    error_message?: string;
  } | null;
  branding: {
    organization: string;
    product: string;
    logo_url?: string;
    primary_tagline: string;
    secondary_tagline: string;
    support_number: string;
    powered_by: string;
    brand_colors: {
      primary: string;
      secondary: string;
      accent: string;
      bg: string;
    };
  };
  pricing: {
    bw_price_per_page: number;
    color_price_per_page: number;
    currency: string;
  };
  printer: {
    status: string;
    display_name: string;
    model: string;
    supports_color: boolean;
  };
}

export default function KioskMonitorPage({
  params,
}: {
  params: Promise<{ kioskId: string }>;
}) {
  const resolvedParams = use(params);
  const kioskId = resolvedParams.kioskId || 'GITAM-SPK-001';

  const [data, setData] = useState<KioskStatusData | null>(null);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [completedCountdown, setCompletedCountdown] = useState<number>(8);
  const [realtimeConnected, setRealtimeConnected] = useState<boolean>(false);
  const [networkError, setNetworkError] = useState<boolean>(false);

  // Live Clock Tick
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch Authoritative Kiosk State from dedicated endpoint
  const fetchAuthoritativeState = useCallback(async () => {
    try {
      const res = await fetch(`/api/kiosk/${kioskId}/status`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const json: KioskStatusData = await res.json();
      setData(json);
      setNetworkError(false);
    } catch (err) {
      console.warn('[KIOSK MONITOR] Status fetch warning:', err);
      setNetworkError(true);
    }
  }, [kioskId]);

  // Initial fetch and resilient heartbeat poll
  useEffect(() => {
    fetchAuthoritativeState();
    const interval = setInterval(fetchAuthoritativeState, 3000);
    return () => clearInterval(interval);
  }, [fetchAuthoritativeState]);

  // Supabase Realtime Subscription for instant state transition upon upload/payment
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setRealtimeConnected(true);
      return;
    }

    try {
      const channel = supabase
        .channel(`kiosk-monitor-${kioskId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'print_jobs',
            filter: `kiosk_id=eq.${kioskId}`,
          },
          () => {
            fetchAuthoritativeState();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'kiosks',
            filter: `id=eq.${kioskId}`,
          },
          () => {
            fetchAuthoritativeState();
          }
        )
        .subscribe((status) => {
          setRealtimeConnected(status === 'SUBSCRIBED');
        });

      return () => {
        supabase.removeChannel(channel);
      };
    } catch {
      setRealtimeConnected(true);
    }
  }, [kioskId, fetchAuthoritativeState]);

  // Handle COMPLETED state automatic timeout back to static IDLE
  useEffect(() => {
    if (data?.monitor_state === 'COMPLETED') {
      setCompletedCountdown(8);
      const timer = setInterval(() => {
        setCompletedCountdown((prev) => {
          if (prev <= 1) {
            // Tell backend to reset kiosk active job to IDLE
            fetch(`/api/kiosk/${kioskId}/status`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'reset_idle' }),
            }).then(() => fetchAuthoritativeState());
            return 8;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [data?.monitor_state, kioskId, fetchAuthoritativeState]);

  // Fallbacks if data loading
  const branding = data?.branding || {
    organization: 'GITAM',
    product: 'SMARTPRINT',
    primary_tagline: 'Autonomous Student Printing',
    secondary_tagline: 'Scan. Upload. Pay. Print.',
    support_number: '9006496970',
    powered_by: 'Nikhil',
    brand_colors: { primary: '#0d253f', secondary: '#1e40af', accent: '#d97706', bg: '#ffffff' },
  };

  const pricing = data?.pricing || {
    bw_price_per_page: 1.0,
    color_price_per_page: 5.0,
    currency: 'INR',
  };

  const printer = data?.printer || {
    status: 'READY',
    display_name: 'HP LaserJet USB',
    model: 'LaserJet Pro',
    supports_color: false,
  };

  const monitorState: KioskMonitorState = data?.monitor_state || 'IDLE';
  const activeJob = data?.active_job;

  const displayOrg = branding.organization.replace(new RegExp(`\\s*${branding.product}$`, 'i'), '').trim() || branding.organization;

  // Permanent Kiosk QR Target URL (Public entry point - Never cycling session tokens in QR)
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const permanentQrTarget =
    data?.kiosk?.permanent_qr_url && origin
      ? `${origin}${data.kiosk.permanent_qr_url}`
      : `${origin}/print?kiosk=${kioskId}`;

  return (
    <div className="h-screen w-screen bg-[#fafbfc] text-slate-900 flex flex-col justify-between p-3 sm:p-5 select-none cursor-none overflow-hidden font-sans fixed inset-0 border-4 sm:border-8 border-slate-100">
      {/* 1. TOP HEADER (PREMIUM WHITE WITH GOLD ACCENT) */}
      <header className="flex items-center justify-between bg-white px-5 py-3 rounded-2xl shadow-sm border border-slate-200/80 shrink-0 relative z-20">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Printer className="w-6 h-6 sm:w-7 sm:h-7 text-amber-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
                {displayOrg}{' '}
                <span className="text-amber-600">{branding.product}</span>
              </h1>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                Kiosk Mode
              </span>
            </div>
            <p className="text-xs font-medium text-slate-500 tracking-wide truncate">
              {branding.primary_tagline} • {data?.kiosk?.location || 'Campus Knowledge Center'}
            </p>
          </div>
        </div>

        {/* Live Clock & Kiosk Identifier */}
        <div className="text-right shrink-0">
          <div className="text-2xl font-mono font-black text-slate-900 tracking-widest">
            {currentTime}
          </div>
          <div className="text-xs font-semibold text-slate-500 flex items-center justify-end gap-1.5">
            <span>KIOSK ID:</span>
            <strong className="text-slate-800 font-mono bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
              {kioskId}
            </strong>
          </div>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE: STRICT MONITOR STATE MACHINE */}
      <main className="flex-1 flex items-center justify-center py-2 sm:py-4 px-2 min-h-0 overflow-y-auto relative z-10 w-full">
        {/* ============================================================== */}
        {/* STATE A: IDLE (STRICTLY STATIC UNTIL A VALID DOCUMENT IS UPLOADED) */}
        {/* ============================================================== */}
        {monitorState === 'IDLE' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 lg:gap-8 items-center max-w-5xl w-full my-auto px-2">
            {/* PERMANENT QR CODE CARD */}
            <div className="md:col-span-5 flex justify-center">
              <div className="bg-white p-4 sm:p-5 rounded-2xl sm:rounded-3xl shadow-lg border-2 border-amber-500/40 flex flex-col items-center justify-center w-full max-w-[270px]">
                <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-inner flex items-center justify-center">
                  <QRCodeSVG
                    value={permanentQrTarget}
                    size={185}
                    level="H"
                    includeMargin={false}
                    className="w-40 h-40 sm:w-44 sm:h-44"
                  />
                </div>

                <div className="mt-3 text-center">
                  <span className="text-[11px] sm:text-xs font-black text-slate-900 uppercase tracking-widest block">
                    SCAN TO START PRINTING
                  </span>
                  <span className="text-[10px] sm:text-[11px] font-medium text-slate-500 block mt-0.5">
                    Point phone camera at QR code
                  </span>
                </div>
              </div>
            </div>

            {/* STATIC INSTRUCTIONS & 4-STEP SEQUENCE */}
            <div className="md:col-span-7 space-y-3 sm:space-y-4 text-left">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200/80 text-amber-800 text-[11px] font-bold tracking-wide">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  <span>Autonomous Touchless Printing</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 leading-tight">
                  Scan. Upload. Pay. Print.
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-normal">
                  No app download or kiosk touch required. Upload your document securely from your phone, complete payment, and collect your pages instantly.
                </p>
              </div>

              {/* 4-Step Visual Sequence - 2x2 grid for clean compact display */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-700">
                <div className="flex items-center gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="w-6 h-6 rounded-md bg-amber-500 text-white font-black flex items-center justify-center text-[11px] shrink-0">
                    1
                  </span>
                  <div className="min-w-0">
                    <span className="font-bold text-slate-900 block truncate text-[11px]">SCAN & UPLOAD</span>
                    <span className="text-slate-500 block text-[10px] truncate">Scan QR & upload PDF or JPG</span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="w-6 h-6 rounded-md bg-amber-500 text-white font-black flex items-center justify-center text-[11px] shrink-0">
                    2
                  </span>
                  <div className="min-w-0">
                    <span className="font-bold text-slate-900 block truncate text-[11px]">CONFIGURE PAGES</span>
                    <span className="text-slate-500 block text-[10px] truncate">Select pages, copies & color</span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="w-6 h-6 rounded-md bg-amber-500 text-white font-black flex items-center justify-center text-[11px] shrink-0">
                    3
                  </span>
                  <div className="min-w-0">
                    <span className="font-bold text-slate-900 block truncate text-[11px]">INSTANT UPI PAYMENT</span>
                    <span className="text-slate-500 block text-[10px] truncate">Pay with UPI, GPay, PhonePe</span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="w-6 h-6 rounded-md bg-amber-500 text-white font-black flex items-center justify-center text-[11px] shrink-0">
                    4
                  </span>
                  <div className="min-w-0">
                    <span className="font-bold text-slate-900 block truncate text-[11px]">COLLECT PRINTOUT</span>
                    <span className="text-slate-500 block text-[10px] truncate">Laser print & instant shred</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* STATE B: DOCUMENT_RECEIVED (PRIVACY-SAFE CONFIRMATION) */}
        {/* ============================================================== */}
        {monitorState === 'DOCUMENT_RECEIVED' && (
          <div className="bg-white border-2 border-amber-500/60 rounded-3xl p-10 max-w-xl w-full text-center shadow-xl space-y-5">
            <div className="w-20 h-20 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
              <FileCheck2 className="w-10 h-10" />
            </div>
            <div className="space-y-1.5">
              <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold uppercase tracking-widest border border-amber-300">
                DOCUMENT RECEIVED
              </span>
              <h2 className="text-3xl font-black text-slate-900">Document Received Successfully</h2>
              <p className="text-sm text-slate-600">
                Reference: <strong className="font-mono text-slate-900 bg-slate-100 px-2 py-0.5 rounded">{activeJob?.masked_id}</strong>
              </p>
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-600">
              Validating document structure and billable pages... Please configure print options on your mobile device.
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* STATE C: PROCESSING (AWAITING PAYMENT OR CUPS SPOOLING) */}
        {/* ============================================================== */}
        {monitorState === 'PROCESSING' && (
          <div className="bg-white border-2 border-amber-500/60 rounded-3xl p-10 max-w-xl w-full text-center shadow-xl space-y-5">
            <div className="w-20 h-20 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
              {activeJob?.status === 'PAYMENT_PENDING' ? (
                <CreditCard className="w-10 h-10 animate-pulse text-amber-600" />
              ) : (
                <RotateCcw className="w-10 h-10 animate-spin text-amber-600" />
              )}
            </div>

            <div className="space-y-1.5">
              <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold uppercase tracking-widest border border-amber-300">
                {activeJob?.status === 'PAYMENT_PENDING' ? 'AWAITING PAYMENT' : 'PREPARING PRINT JOB'}
              </span>
              <h2 className="text-3xl font-black text-slate-900">
                {activeJob?.status === 'PAYMENT_PENDING'
                  ? 'Complete Payment On Mobile'
                  : 'Preparing Document For Printer'}
              </h2>
              <p className="text-sm text-slate-600">
                Job Reference: <strong className="font-mono text-slate-900 bg-slate-100 px-2 py-0.5 rounded">{activeJob?.masked_id}</strong>
              </p>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-600 space-y-1">
              <p className="font-semibold text-slate-800">
                {activeJob?.status === 'PAYMENT_PENDING'
                  ? 'Please approve the Razorpay UPI transaction on your phone.'
                  : 'Payment verified. Spooling to local Raspberry Pi CUPS print engine.'}
              </p>
              <p className="text-[11px] text-slate-500">
                Zero-Retention Security: Document resides only in volatile memory during print.
              </p>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* STATE D: PRINTING (ACTIVE JOB WITH ACTUAL PRINTER STATUS) */}
        {/* ============================================================== */}
        {monitorState === 'PRINTING' && (
          <div className="bg-white border-2 border-emerald-500/60 rounded-3xl p-10 max-w-xl w-full text-center shadow-xl space-y-5">
            <div className="w-20 h-20 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200">
              <Printer className="w-10 h-10 animate-bounce" />
            </div>

            <div className="space-y-1.5">
              <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold uppercase tracking-widest border border-emerald-300">
                PRINTING IN PROGRESS
              </span>
              <h2 className="text-3xl font-black text-slate-900">Printing Your Document</h2>
              <p className="text-sm text-slate-600">
                Job Reference: <strong className="font-mono text-slate-900 bg-slate-100 px-2 py-0.5 rounded">{activeJob?.masked_id}</strong>
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 py-2 text-xs">
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <span className="text-slate-400 block text-[10px]">TOTAL PAGES</span>
                <span className="font-black text-slate-800">{activeJob?.pages_total || 1}</span>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <span className="text-slate-400 block text-[10px]">COPIES</span>
                <span className="font-black text-slate-800">{activeJob?.copies || 1}</span>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <span className="text-slate-400 block text-[10px]">OUTPUT</span>
                <span className="font-black text-slate-800">{activeJob?.is_color ? 'COLOUR' : 'B&W'}</span>
              </div>
            </div>

            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium">
              Please collect your pages from the printer output tray.
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* STATE E: COMPLETED (BRIEF COUNTDOWN, THEN AUTOMATIC RESET TO IDLE) */}
        {/* ============================================================== */}
        {monitorState === 'COMPLETED' && (
          <div className="bg-white border-2 border-emerald-500/60 rounded-3xl p-10 max-w-xl w-full text-center shadow-xl space-y-5">
            <div className="w-20 h-20 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200 shadow-sm">
              <CheckCircle2 className="w-12 h-12" />
            </div>

            <div className="space-y-1.5">
              <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold uppercase tracking-widest border border-emerald-300">
                PRINT COMPLETED ✓
              </span>
              <h2 className="text-3xl font-black text-slate-900">Please Collect Your Document</h2>
              <p className="text-sm text-slate-600">
                Job Reference: <strong className="font-mono text-slate-900 bg-slate-100 px-2 py-0.5 rounded">{activeJob?.masked_id}</strong>
              </p>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 flex items-center justify-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Zero-Retention File Privacy: Temporary document permanently shredded.</span>
            </div>

            <div className="text-xs text-slate-400 font-semibold">
              Returning to IDLE screen in {completedCountdown}s...
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* STATE F: ERROR / RECOVERY_REQUIRED */}
        {/* ============================================================== */}
        {monitorState === 'RECOVERY_REQUIRED' && (
          <div className="bg-white border-2 border-amber-500 rounded-3xl p-10 max-w-xl w-full text-center shadow-xl space-y-5">
            <div className="w-20 h-20 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
              <AlertTriangle className="w-10 h-10" />
            </div>

            <div className="space-y-1.5">
              <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold uppercase tracking-widest border border-amber-300">
                RECOVERY REQUIRED
              </span>
              <h2 className="text-3xl font-black text-slate-900">Print Recovery In Progress</h2>
              <p className="text-sm text-slate-600">
                Job Reference: <strong className="font-mono text-slate-900 bg-slate-100 px-2 py-0.5 rounded">{activeJob?.masked_id}</strong>
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 space-y-1 text-left">
              <p className="font-bold text-slate-900">
                Reason: {activeJob?.error_message || data?.sub_message || 'Hardware output uncertain'}
              </p>
              <p className="text-slate-500">
                The system will not reprint blindly. Your transaction is preserved in the audit log.
              </p>
            </div>

            <div className="inline-flex items-center gap-2 bg-slate-100 px-4 py-2 rounded-xl border border-slate-200 text-xs text-slate-700">
              <Phone className="w-4 h-4 text-amber-600" />
              <span>For Immediate Support: <strong className="text-slate-900">{branding.support_number}</strong></span>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* STATE G: ERROR (PRINTER OFFLINE OR FATAL DEVICE ERROR) */}
        {/* ============================================================== */}
        {monitorState === 'ERROR' && (
          <div className="bg-white border-2 border-red-400 rounded-3xl p-10 max-w-xl w-full text-center shadow-xl space-y-5">
            <div className="w-20 h-20 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto border border-red-200">
              <AlertTriangle className="w-10 h-10" />
            </div>

            <div className="space-y-1.5">
              <span className="px-3 py-1 rounded-full bg-red-100 text-red-800 text-xs font-bold uppercase tracking-widest border border-red-300">
                SERVICE TEMPORARILY OFFLINE
              </span>
              <h2 className="text-3xl font-black text-slate-900">Printing Temporarily Unavailable</h2>
              <p className="text-sm text-slate-600">
                The local printer is currently offline or undergoing paper tray service.
              </p>
            </div>

            <div className="inline-flex items-center gap-2 bg-slate-100 px-4 py-2 rounded-xl border border-slate-200 text-xs text-slate-700">
              <Phone className="w-4 h-4 text-red-600" />
              <span>For Assistance: <strong className="text-slate-900">{branding.support_number}</strong></span>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* STATE H: MAINTENANCE */}
        {/* ============================================================== */}
        {monitorState === 'MAINTENANCE' && (
          <div className="bg-white border-2 border-amber-400 rounded-3xl p-10 max-w-xl w-full text-center shadow-xl space-y-5">
            <div className="w-20 h-20 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
              <AlertTriangle className="w-10 h-10" />
            </div>

            <div className="space-y-1.5">
              <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold uppercase tracking-widest border border-amber-300">
                SCHEDULED MAINTENANCE
              </span>
              <h2 className="text-3xl font-black text-slate-900">Kiosk Under Maintenance</h2>
              <p className="text-sm text-slate-600">
                This smart printer kiosk is undergoing routine maintenance and will return shortly.
              </p>
            </div>

            <div className="inline-flex items-center gap-2 bg-slate-100 px-4 py-2 rounded-xl border border-slate-200 text-xs text-slate-700">
              <Phone className="w-4 h-4 text-amber-600" />
              <span>Contact Support: <strong className="text-slate-900">{branding.support_number}</strong></span>
            </div>
          </div>
        )}
      </main>

      {/* 3. BOTTOM STRIP: HARDWARE STATUS, PRICING & ZERO-RETENTION FOOTER */}
      <footer className="border-t border-slate-200 bg-white p-2.5 sm:p-3.5 rounded-2xl shadow-sm space-y-2 shrink-0 relative z-20">
        {/* Telemetry and Pricing Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="flex items-center justify-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl py-1.5 px-3">
            <Printer className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="font-semibold text-slate-600 text-[11px]">Printer:</span>
            <span className="font-bold text-emerald-700 flex items-center gap-1.5 text-[11px]">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>{printer.status}</span>
            </span>
          </div>

          <div className="flex items-center justify-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl py-1.5 px-3">
            <Wifi className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="font-semibold text-slate-600 text-[11px]">Service:</span>
            <span className="font-bold text-emerald-700 flex items-center gap-1.5 text-[11px]">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>{networkError ? 'OFFLINE' : 'ONLINE'}</span>
            </span>
          </div>

          <div className="flex items-center justify-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl py-1.5 px-3">
            <span className="font-semibold text-slate-600 text-[11px]">B&W Pages:</span>
            <span className="font-bold text-slate-900 text-[11px]">₹{pricing.bw_price_per_page}/page</span>
          </div>

          <div className="flex items-center justify-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl py-1.5 px-3">
            <span className="font-semibold text-slate-600 text-[11px]">Colour Pages:</span>
            <span className="font-bold text-amber-700 text-[11px]">₹{pricing.color_price_per_page}/page</span>
          </div>
        </div>

        {/* Privacy + Support + Powered By Details */}
        <div className="flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 gap-1.5 pt-1.5 border-t border-slate-100">
          <div className="flex items-center gap-1.5 font-medium text-slate-700">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>Zero-Retention File Privacy: Ephemeral storage only</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 text-slate-700">
              <Phone className="w-3 h-3 text-amber-600 shrink-0" />
              <span>
                Support: <strong className="text-slate-900 font-bold">{branding.support_number}</strong>
              </span>
            </div>
            <div>
              Powered by <strong className="text-slate-900 font-bold">{branding.powered_by}</strong>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
