'use client';

import React, { useState, useEffect, use } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Printer,
  Wifi,
  Monitor,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Phone,
  Clock,
  Sparkles,
  ShieldCheck,
  CreditCard,
  FileCheck,
  Zap,
} from 'lucide-react';
import { DEFAULT_BRANDING, DEFAULT_PRICING } from '@/lib/constants';

type KioskScreenState =
  | 'READY'
  | 'CUSTOMER_CONNECTED'
  | 'UPLOAD_RECEIVED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_VERIFIED'
  | 'PROCESSING'
  | 'PRINTING'
  | 'COMPLETED'
  | 'ERROR'
  | 'MAINTENANCE';

export default function KioskDisplayPage({
  params,
}: {
  params: Promise<{ kioskId: string }>;
}) {
  const resolvedParams = use(params);
  const kioskId = resolvedParams.kioskId || 'GITAM-SPK-001';

  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [pricing, setPricing] = useState(DEFAULT_PRICING);
  const [session, setSession] = useState<{ id: string; session_token: string; expires_at: string } | null>(null);
  const [timeLeftSec, setTimeLeftSec] = useState<number>(900); // 15 mins default
  const [printerStatus, setPrinterStatus] = useState<string>('READY');
  const [systemOnline, setSystemOnline] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<string>('');

  // Active Job State
  const [activeJob, setActiveJob] = useState<any>(null);
  const [kioskState, setKioskState] = useState<KioskScreenState>('READY');
  const [completedCountdown, setCompletedCountdown] = useState<number>(6);

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

  // Fetch Session QR & Brand Config
  const refreshSession = async () => {
    try {
      const res = await fetch('/api/kiosk/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kiosk_id: kioskId }),
      });
      const data = await res.json();
      if (data.session) {
        setSession(data.session);
        const expires = new Date(data.session.expires_at).getTime();
        const now = Date.now();
        setTimeLeftSec(Math.max(0, Math.floor((expires - now) / 1000)));
      }
    } catch (err) {
      console.error('Session refresh error:', err);
    }
  };

  useEffect(() => {
    fetch('/api/branding')
      .then((res) => res.json())
      .then((d) => d.branding && setBranding(d.branding))
      .catch(() => {});

    fetch('/api/pricing')
      .then((res) => res.json())
      .then((d) => d.pricing && setPricing(d.pricing))
      .catch(() => {});

    refreshSession();
  }, [kioskId]);

  // Session timer countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeftSec((prev) => {
        if (prev <= 1) {
          refreshSession();
          return 900;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [kioskId]);

  // Periodic Backend Polling for Kiosk Status & Active Job Lifecycle
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/admin/data');
        const data = await res.json();
        setSystemOnline(true);

        const thisKiosk = data.kiosks?.find((k: any) => k.id === kioskId);
        if (thisKiosk?.maintenance_mode || thisKiosk?.status === 'MAINTENANCE') {
          setKioskState('MAINTENANCE');
          return;
        }

        const thisPrinter = data.printers?.find((p: any) => p.kiosk_id === kioskId);
        if (thisPrinter) {
          setPrinterStatus(thisPrinter.status);
          if (thisPrinter.status === 'ERROR' || thisPrinter.status === 'OFFLINE') {
            setKioskState('ERROR');
            return;
          }
        }

        // Determine if an active job is targeting this kiosk
        const jobs = data.jobs || [];
        const runningJob = jobs.find(
          (j: any) =>
            j.kiosk_id === kioskId &&
            ['PAYMENT_PENDING', 'PAYMENT_VERIFIED', 'DOWNLOADING', 'PROCESSING', 'SUBMITTED_TO_CUPS', 'PRINTING', 'COMPLETED'].includes(j.status)
        );

        if (runningJob) {
          setActiveJob(runningJob);
          if (runningJob.status === 'PAYMENT_PENDING') {
            setKioskState('PAYMENT_PENDING');
          } else if (runningJob.status === 'PAYMENT_VERIFIED') {
            setKioskState('PAYMENT_VERIFIED');
          } else if (['DOWNLOADING', 'PROCESSING', 'SUBMITTED_TO_CUPS'].includes(runningJob.status)) {
            setKioskState('PROCESSING');
          } else if (runningJob.status === 'PRINTING') {
            setKioskState('PRINTING');
          } else if (runningJob.status === 'COMPLETED') {
            setKioskState('COMPLETED');
          }
        } else {
          setActiveJob(null);
          setKioskState('READY');
        }
      } catch (e) {
        setSystemOnline(false);
      }
    }, 2500);

    return () => clearInterval(pollInterval);
  }, [kioskId]);

  // Auto-reset from COMPLETED state to READY after countdown
  useEffect(() => {
    if (kioskState === 'COMPLETED') {
      setCompletedCountdown(6);
      const timer = setInterval(() => {
        setCompletedCountdown((prev) => {
          if (prev <= 1) {
            setKioskState('READY');
            setActiveJob(null);
            refreshSession();
            return 6;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [kioskState]);

  // Dynamic QR Code Target URL with secure session token route
  const qrTargetUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/print/session/${session?.session_token || 'sess_demo_001'}`
    : `http://localhost:3000/print/session/${session?.session_token || 'sess_demo_001'}`;

  return (
    <div className="h-screen w-screen bg-gradient-to-b from-[#0d253f] via-[#102d4d] to-[#0a1c2f] text-white flex flex-col justify-between p-6 select-none cursor-none overflow-hidden font-sans fixed inset-0">
      {/* 1. TOP HEADER (FIXED, NON-SCROLLING) */}
      <header className="flex items-center justify-between border-b border-slate-700/60 pb-4 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25 shrink-0">
            <Printer className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-2">
              {branding.organization} <span className="text-blue-400">{branding.product}</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 font-semibold tracking-wider">
              {branding.primary_tagline}
            </p>
          </div>
        </div>

        {/* Live Clock & Kiosk ID */}
        <div className="text-right shrink-0">
          <div className="text-2xl sm:text-3xl font-mono font-black text-white tracking-widest">
            {currentTime}
          </div>
          <div className="text-xs font-semibold text-slate-400">
            Kiosk ID: <strong className="text-sky-300 font-mono">{kioskId}</strong>
          </div>
        </div>
      </header>

      {/* 2. MAIN CENTER CONTENT BASED ON STATE */}
      <main className="flex-1 flex items-center justify-center py-4 min-h-0">
        {/* STATE: READY (DEFAULT SCREEN) */}
        {kioskState === 'READY' && (
          <div className="flex flex-col lg:flex-row items-center justify-center gap-10 max-w-5xl w-full">
            {/* LARGE DYNAMIC QR CODE CARD ON LEFT */}
            <div className="bg-white p-6 rounded-3xl shadow-2xl border-4 border-blue-500/60 flex flex-col items-center justify-center relative glow-card shrink-0">
              <div className="bg-white p-2.5 rounded-2xl">
                <QRCodeSVG
                  value={qrTargetUrl}
                  size={260}
                  level="H"
                  includeMargin={false}
                />
              </div>

              {/* SCAN TO START PRINTING BANNER */}
              <div className="mt-3 text-center">
                <span className="text-xs font-black text-slate-900 uppercase tracking-widest block">
                  SCAN TO START PRINTING
                </span>
                <span className="text-[11px] font-semibold text-slate-500 flex items-center justify-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3 text-blue-600" />
                  <span>Refreshes in {Math.floor(timeLeftSec / 60)}m {timeLeftSec % 60}s</span>
                </span>
              </div>
            </div>

            {/* INSTRUCTIONS & VISUAL SEQUENCE ON RIGHT */}
            <div className="space-y-4 max-w-md text-left">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-400/40 text-blue-300 text-xs font-bold tracking-wide">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Autonomous Student Printing</span>
                </div>
                <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-white leading-tight">
                  SCAN TO START PRINTING
                </h2>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  Scan with your phone to upload, edit, pay and print. No app download or touch required.
                </p>
              </div>

              {/* Visual Sequence: Upload -> Select Pages -> Pay -> Print */}
              <div className="space-y-2 text-xs text-slate-200">
                <div className="flex items-center gap-3 bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                  <span className="w-6 h-6 rounded-md bg-blue-600 text-white font-black flex items-center justify-center text-[11px] shrink-0">
                    1
                  </span>
                  <span className="font-bold">UPLOAD — Upload document (PDF, JPG, PNG)</span>
                </div>
                <div className="flex items-center gap-3 bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                  <span className="w-6 h-6 rounded-md bg-blue-600 text-white font-black flex items-center justify-center text-[11px] shrink-0">
                    2
                  </span>
                  <span className="font-bold">SELECT PAGES — Choose page ranges, copies & color</span>
                </div>
                <div className="flex items-center gap-3 bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                  <span className="w-6 h-6 rounded-md bg-blue-600 text-white font-black flex items-center justify-center text-[11px] shrink-0">
                    3
                  </span>
                  <span className="font-bold">PAY — Secure instant payment via Razorpay UPI</span>
                </div>
                <div className="flex items-center gap-3 bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                  <span className="w-6 h-6 rounded-md bg-blue-600 text-white font-black flex items-center justify-center text-[11px] shrink-0">
                    4
                  </span>
                  <span className="font-bold">PRINT — HP Printer outputs document immediately</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STATE: PAYMENT PENDING */}
        {kioskState === 'PAYMENT_PENDING' && (
          <div className="bg-slate-900/90 border-2 border-amber-500/80 rounded-3xl p-10 max-w-xl w-full text-center shadow-2xl space-y-5 animate-in fade-in duration-300">
            <div className="w-20 h-20 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto animate-pulse">
              <CreditCard className="w-10 h-10" />
            </div>
            <div className="space-y-1">
              <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold uppercase tracking-widest border border-amber-500/40">
                PAYMENT PENDING
              </span>
              <h2 className="text-3xl font-black text-white">Complete payment on your phone</h2>
              <p className="text-sm text-slate-300">
                Job ID: <strong className="font-mono text-amber-300">{activeJob?.id}</strong>
              </p>
            </div>
            <p className="text-xs text-slate-400">
              Please finish the UPI payment flow on your mobile screen. The HP printer will begin printing automatically upon verified confirmation.
            </p>
          </div>
        )}

        {/* STATE: PAYMENT VERIFIED & PROCESSING */}
        {(kioskState === 'PAYMENT_VERIFIED' || kioskState === 'PROCESSING') && (
          <div className="bg-slate-900/90 border-2 border-blue-500/80 rounded-3xl p-10 max-w-xl w-full text-center shadow-2xl space-y-5 animate-in fade-in duration-300">
            <div className="w-20 h-20 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center mx-auto animate-spin">
              <RefreshCw className="w-10 h-10" />
            </div>
            <div className="space-y-1">
              <span className="px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs font-bold uppercase tracking-widest border border-blue-500/40">
                PAYMENT VERIFIED ✓
              </span>
              <h2 className="text-3xl font-black text-white">Preparing Print Document</h2>
              <p className="text-sm text-slate-300">
                Downloading document securely to Raspberry Pi controller...
              </p>
            </div>
            <div className="p-3 bg-slate-800/90 rounded-2xl border border-slate-700 text-xs text-slate-300">
              CUPS rasterizer active • Zero permanent retention
            </div>
          </div>
        )}

        {/* STATE: PRINTING */}
        {kioskState === 'PRINTING' && (
          <div className="bg-slate-900/90 border-2 border-emerald-500/80 rounded-3xl p-10 max-w-xl w-full text-center shadow-2xl space-y-5 animate-pulse">
            <div className="w-20 h-20 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
              <Printer className="w-10 h-10 animate-bounce" />
            </div>
            <div className="space-y-1">
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold uppercase tracking-widest border border-emerald-500/40">
                PRINTING IN PROGRESS
              </span>
              <h2 className="text-3xl font-black text-white">Printing Document</h2>
              <p className="text-sm text-slate-300">
                Job <strong className="font-mono text-sky-300">{activeJob?.id}</strong> • Pages: {activeJob?.pages_total || 1} • Copies: {activeJob?.copies || 1}
              </p>
            </div>
            <div className="p-3.5 bg-slate-800/90 rounded-2xl border border-slate-700 text-xs text-slate-300 flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Please collect your document from the HP printer output tray.</span>
            </div>
          </div>
        )}

        {/* STATE: COMPLETED */}
        {kioskState === 'COMPLETED' && (
          <div className="bg-slate-900/90 border-2 border-emerald-400/90 rounded-3xl p-10 max-w-xl w-full text-center shadow-2xl space-y-5 animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/30">
              <CheckCircle2 className="w-12 h-12" />
            </div>
            <div className="space-y-1">
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold uppercase tracking-widest border border-emerald-500/40">
                PRINT COMPLETED ✓
              </span>
              <h2 className="text-3xl font-black text-white">Please Collect Your Document</h2>
              <p className="text-sm text-slate-300">
                Your print job has been completed by the HP printer.
              </p>
            </div>
            <div className="p-3 bg-emerald-950/60 border border-emerald-800/60 rounded-xl text-xs text-emerald-300">
              Ephemeral Security: Temporary file permanently shredded.
            </div>
            <div className="text-[11px] text-slate-400 font-semibold">
              Returning to READY screen in {completedCountdown}s...
            </div>
          </div>
        )}

        {/* STATE: ERROR */}
        {kioskState === 'ERROR' && (
          <div className="bg-slate-900/90 border-2 border-red-500/80 rounded-3xl p-10 max-w-xl w-full text-center shadow-2xl space-y-5">
            <div className="w-20 h-20 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-10 h-10" />
            </div>
            <div className="space-y-1">
              <h2 className="text-3xl font-black text-white">Printing Temporarily Unavailable</h2>
              <p className="text-sm text-slate-300">
                The local printer is currently offline or undergoing service.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 bg-slate-800 px-4 py-2 rounded-xl border border-slate-700 text-xs text-slate-300">
              <Phone className="w-4 h-4 text-emerald-400" />
              <span>For Immediate Support: <strong className="text-white">{branding.support_number}</strong></span>
            </div>
          </div>
        )}

        {/* STATE: MAINTENANCE */}
        {kioskState === 'MAINTENANCE' && (
          <div className="bg-slate-900/90 border-2 border-amber-500/80 rounded-3xl p-10 max-w-xl w-full text-center shadow-2xl space-y-5">
            <div className="w-20 h-20 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto animate-pulse">
              <AlertTriangle className="w-10 h-10" />
            </div>
            <div className="space-y-1">
              <h2 className="text-3xl font-black text-white">SMARTPRINT TEMPORARILY UNAVAILABLE</h2>
              <p className="text-sm text-slate-300">
                {branding.maintenance_message}
              </p>
            </div>
            <div className="inline-flex items-center gap-2 bg-slate-800 px-4 py-2 rounded-xl border border-slate-700 text-xs text-slate-300">
              <Phone className="w-4 h-4 text-emerald-400" />
              <span>For Assistance: <strong className="text-white">{branding.support_number}</strong></span>
            </div>
          </div>
        )}
      </main>

      {/* 3. HARDWARE STATUS & RATES STRIP (FIXED, NON-SCROLLING) */}
      <div className="border-t border-slate-700/60 pt-3 shrink-0 space-y-3">
        {/* Status Indicators */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="flex items-center justify-center gap-2.5 bg-slate-900/80 border border-slate-700/70 rounded-xl py-2 px-3">
            <Printer className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-slate-300">Printer:</span>
            <span className="font-black text-emerald-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>{printerStatus === 'READY' ? 'READY' : printerStatus}</span>
            </span>
          </div>

          <div className="flex items-center justify-center gap-2.5 bg-slate-900/80 border border-slate-700/70 rounded-xl py-2 px-3">
            <Wifi className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-slate-300">System:</span>
            <span className="font-black text-emerald-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span>{systemOnline ? 'ONLINE' : 'OFFLINE'}</span>
            </span>
          </div>

          <div className="flex items-center justify-center gap-2 bg-slate-900/80 border border-slate-700/70 rounded-xl py-2 px-3">
            <span className="font-bold text-slate-300">B&W Pages:</span>
            <span className="font-black text-emerald-400">₹{pricing.bw_price_per_page}/page</span>
          </div>

          <div className="flex items-center justify-center gap-2 bg-slate-900/80 border border-slate-700/70 rounded-xl py-2 px-3">
            <span className="font-bold text-slate-300">Color Pages:</span>
            <span className="font-black text-sky-400">₹{pricing.color_price_per_page}/page</span>
          </div>
        </div>

        {/* Bottom Bar: Privacy Statement + Support + Powered By */}
        <footer className="flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-2 pt-1 border-t border-slate-800">
          <div className="flex items-center gap-2 text-slate-300 font-semibold">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Zero-Retention File Privacy</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-white font-medium">
              <Phone className="w-3.5 h-3.5 text-emerald-400" />
              <span>For Enquiry & Support: <strong className="text-white font-bold">{branding.support_number}</strong></span>
            </div>
            <div>
              Powered by <strong className="text-white">{branding.powered_by}</strong>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
