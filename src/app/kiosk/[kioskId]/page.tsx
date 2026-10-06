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
  Cpu,
  Clock,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import { DEFAULT_BRANDING, DEFAULT_PRICING } from '@/lib/constants';

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
  const [activeJob, setActiveJob] = useState<any>(null);
  const [isMaintenance, setIsMaintenance] = useState<boolean>(false);
  const [printerStatus, setPrinterStatus] = useState<string>('READY');
  const [currentTime, setCurrentTime] = useState<string>('');

  // Clock tick
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

  // Fetch Session QR & Config
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
    // Initial fetch
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

  // Session expiry countdown & Periodic Poll
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeftSec((prev) => {
        if (prev <= 1) {
          refreshSession();
          return 900;
        }
        return prev - 1;
      });
    }, 1000);

    // Poll for active jobs on this kiosk
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/admin/data');
        const data = await res.json();
        const thisKiosk = data.kiosks?.find((k: any) => k.id === kioskId);
        if (thisKiosk) {
          setIsMaintenance(thisKiosk.maintenance_mode || thisKiosk.status === 'MAINTENANCE');
        }
        const thisPrinter = data.printers?.find((p: any) => p.kiosk_id === kioskId);
        if (thisPrinter) {
          setPrinterStatus(thisPrinter.status);
        }

        // Check if any job is currently PRINTING or SUBMITTED_TO_CUPS
        const currentPrintingJob = data.jobs?.find(
          (j: any) =>
            j.kiosk_id === kioskId &&
            ['DOWNLOADING', 'PROCESSING', 'SUBMITTED_TO_CUPS', 'PRINTING'].includes(j.status)
        );
        setActiveJob(currentPrintingJob || null);
      } catch (e) {}
    }, 3000);

    return () => {
      clearInterval(interval);
      clearInterval(pollInterval);
    };
  }, [kioskId]);

  // Dynamic QR Code Target URL
  const qrTargetUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/print?kiosk_id=${kioskId}&session_id=${session?.id || ''}`
    : `http://localhost:3000/print?kiosk_id=${kioskId}`;

  // Maintenance Mode Screen
  if (isMaintenance) {
    return (
      <div className="h-screen w-screen bg-[#0d253f] text-white flex flex-col items-center justify-center p-8 text-center select-none cursor-none">
        <div className="max-w-xl space-y-6">
          <div className="w-24 h-24 rounded-3xl bg-amber-500/20 border border-amber-400/40 text-amber-400 flex items-center justify-center mx-auto animate-pulse">
            <AlertTriangle className="w-12 h-12" />
          </div>
          <h1 className="text-4xl font-black tracking-tight text-white">
            SMARTPRINT TEMPORARILY UNAVAILABLE
          </h1>
          <p className="text-lg text-slate-300 leading-relaxed">
            {branding.maintenance_message}
          </p>
          <div className="pt-6 border-t border-slate-700/80 inline-flex items-center gap-3 bg-slate-900/80 px-6 py-3 rounded-2xl border border-slate-700">
            <Phone className="w-5 h-5 text-emerald-400" />
            <div className="text-left">
              <span className="text-xs text-slate-400 block font-semibold">For Immediate Assistance</span>
              <span className="text-lg font-black text-white">{branding.support_number}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-gradient-to-b from-[#0d253f] via-[#102a45] to-[#0a1c2f] text-white flex flex-col justify-between p-8 select-none cursor-none overflow-hidden font-sans">
      {/* Top Header Bar */}
      <header className="flex items-center justify-between border-b border-slate-700/60 pb-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <Printer className="w-9 h-9 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-2">
              {branding.organization} <span className="text-blue-400">{branding.product}</span>
            </h1>
            <p className="text-sm text-slate-400 font-semibold tracking-wider">
              {branding.primary_tagline}
            </p>
          </div>
        </div>

        {/* Live Clock & Kiosk ID */}
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-3xl font-mono font-black text-white tracking-wider">
              {currentTime}
            </div>
            <div className="text-xs font-semibold text-slate-400">
              Kiosk ID: <strong className="text-sky-300">{kioskId}</strong>
            </div>
          </div>
        </div>
      </header>

      {/* Center Hero / Dynamic QR Display */}
      <main className="flex-1 flex items-center justify-center py-6">
        {activeJob ? (
          // ACTIVE PRINTING OVERLAY
          <div className="bg-slate-900/90 border-2 border-blue-500/80 rounded-3xl p-12 max-w-2xl w-full text-center shadow-2xl space-y-6 animate-pulse">
            <div className="w-24 h-24 rounded-full bg-blue-600/30 text-blue-400 flex items-center justify-center mx-auto">
              <Printer className="w-12 h-12 animate-bounce" />
            </div>
            <div className="space-y-2">
              <span className="px-3.5 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs font-bold uppercase tracking-widest border border-blue-500/40">
                ACTIVE JOB IN PROGRESS
              </span>
              <h2 className="text-3xl font-black text-white">Printing in Progress</h2>
              <p className="text-base text-slate-300">
                Job <span className="font-mono font-bold text-sky-300">{activeJob.id}</span> is actively being processed by the HP LaserJet printer.
              </p>
            </div>
            <div className="p-4 bg-slate-800/80 rounded-2xl border border-slate-700 text-sm text-slate-300 flex items-center justify-center gap-3">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <span>Please collect your document directly from the output tray.</span>
            </div>
          </div>
        ) : (
          // NORMAL READY KIOSK DISPLAY WITH DYNAMIC QR
          <div className="flex flex-col lg:flex-row items-center justify-center gap-14 max-w-5xl w-full">
            {/* Dynamic QR Box */}
            <div className="bg-white p-6 rounded-3xl shadow-2xl border-4 border-blue-500/50 flex flex-col items-center justify-center relative glow-card">
              <div className="bg-white p-3 rounded-2xl">
                <QRCodeSVG
                  value={qrTargetUrl}
                  size={260}
                  level="H"
                  includeMargin={false}
                />
              </div>

              {/* Expiry Countdown */}
              <div className="mt-4 flex items-center gap-2 text-xs font-bold text-slate-800 bg-slate-100 px-3.5 py-1.5 rounded-full">
                <Clock className="w-3.5 h-3.5 text-blue-600" />
                <span>
                  Session refreshes in: {Math.floor(timeLeftSec / 60)}m {timeLeftSec % 60}s
                </span>
              </div>
            </div>

            {/* Step-by-Step Instructions */}
            <div className="space-y-6 max-w-md text-left">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-400/40 text-blue-300 text-xs font-bold tracking-wide">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Instant Mobile Kiosk Flow</span>
                </div>
                <h2 className="text-4xl font-black tracking-tight text-white leading-tight">
                  Scan QR with your phone camera to start
                </h2>
                <p className="text-sm text-slate-300 leading-relaxed">
                  No app download required. Upload files directly from your phone and pay securely via UPI.
                </p>
              </div>

              {/* Quick Steps */}
              <div className="space-y-3 text-xs text-slate-300">
                <div className="flex items-center gap-3 bg-slate-800/70 p-2.5 rounded-xl border border-slate-700/60">
                  <span className="w-6 h-6 rounded-lg bg-blue-600 text-white font-black flex items-center justify-center text-xs">
                    1
                  </span>
                  <span className="font-semibold text-slate-200">Scan QR Code using Phone Camera</span>
                </div>
                <div className="flex items-center gap-3 bg-slate-800/70 p-2.5 rounded-xl border border-slate-700/60">
                  <span className="w-6 h-6 rounded-lg bg-blue-600 text-white font-black flex items-center justify-center text-xs">
                    2
                  </span>
                  <span className="font-semibold text-slate-200">Upload PDF/Image & Choose Options</span>
                </div>
                <div className="flex items-center gap-3 bg-slate-800/70 p-2.5 rounded-xl border border-slate-700/60">
                  <span className="w-6 h-6 rounded-lg bg-blue-600 text-white font-black flex items-center justify-center text-xs">
                    3
                  </span>
                  <span className="font-semibold text-slate-200">Pay via UPI & Collect Instant Print</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Hardware Status Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-700/60 pt-5">
        <div className="flex items-center justify-center gap-3 bg-slate-900/70 border border-slate-700/70 rounded-2xl py-3 px-4">
          <Printer className="w-5 h-5 text-emerald-400" />
          <div className="text-left">
            <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
              HP USB PRINTER
            </div>
            <div className="text-sm font-black text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>{printerStatus === 'READY' ? 'READY' : printerStatus}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-3 bg-slate-900/70 border border-slate-700/70 rounded-2xl py-3 px-4">
          <Wifi className="w-5 h-5 text-emerald-400" />
          <div className="text-left">
            <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
              INTERNET & BACKEND
            </div>
            <div className="text-sm font-black text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span>CONNECTED</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-3 bg-slate-900/70 border border-slate-700/70 rounded-2xl py-3 px-4">
          <Monitor className="w-5 h-5 text-sky-400" />
          <div className="text-left">
            <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
              KIOSK HARDWARE
            </div>
            <div className="text-sm font-black text-sky-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-400"></span>
              <span>AVAILABLE</span>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing Strip & Support Footer */}
      <footer className="mt-4 pt-4 border-t border-slate-800 flex flex-col md:flex-row items-center justify-between text-xs text-slate-400 gap-4">
        {/* Pricing Rates */}
        <div className="flex items-center gap-4 font-bold">
          <div className="bg-slate-800/90 px-4 py-1.5 rounded-xl border border-slate-700 text-white">
            B&W: <span className="text-emerald-400">₹{pricing.bw_price_per_page} / PAGE</span>
          </div>
          <div className="bg-slate-800/90 px-4 py-1.5 rounded-xl border border-slate-700 text-white">
            COLOR: <span className="text-sky-400">₹{pricing.color_price_per_page} / PAGE</span>
          </div>
        </div>

        {/* Support & Powered By Callout */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-white">
            <Phone className="w-4 h-4 text-emerald-400" />
            <span>
              For Enquiry & Support: <strong className="text-white font-bold">{branding.support_number}</strong>
            </span>
          </div>
          <div className="text-slate-400 font-medium">
            Powered by <strong className="text-white">{branding.powered_by}</strong>
          </div>
        </div>
      </footer>
    </div>
  );
}
