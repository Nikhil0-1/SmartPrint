'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Printer,
  QrCode,
  UploadCloud,
  CreditCard,
  CheckCircle2,
  Shield,
  Zap,
  ArrowRight,
  Monitor,
  LayoutDashboard,
  Clock,
  Sparkles,
  HelpCircle,
} from 'lucide-react';
import { Footer } from '@/components/Footer';
import { DEFAULT_BRANDING, DEFAULT_PRICING } from '@/lib/constants';

export default function LandingPage() {
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [pricing, setPricing] = useState(DEFAULT_PRICING);
  const [kiosks, setKiosks] = useState<any[]>([]);
  const [calcPages, setCalcPages] = useState(5);
  const [calcColor, setCalcColor] = useState(false);
  const [calcCopies, setCalcCopies] = useState(1);

  useEffect(() => {
    fetch('/api/branding')
      .then((res) => res.json())
      .then((data) => data.branding && setBranding(data.branding))
      .catch(() => {});

    fetch('/api/pricing')
      .then((res) => res.json())
      .then((data) => data.pricing && setPricing(data.pricing))
      .catch(() => {});

    fetch('/api/kiosks')
      .then((res) => res.json())
      .then((data) => data.kiosks && setKiosks(data.kiosks))
      .catch(() => {});
  }, []);

  const estimatedTotal =
    calcPages *
      calcCopies *
      (calcColor ? pricing.color_price_per_page : pricing.bw_price_per_page) +
    pricing.service_charge;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 selection:bg-blue-600 selection:text-white">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 bg-[#0d253f]/95 backdrop-blur-md border-b border-slate-800 text-white py-3.5 px-6 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Printer className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-extrabold text-xl tracking-tight text-white flex items-center gap-1.5">
                {branding.organization} <span className="text-blue-400">{branding.product}</span>
              </span>
              <span className="text-[10px] text-slate-400 font-semibold block uppercase tracking-wider">
                Autonomous Campus Kiosk
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/kiosk/GITAM-SPK-001"
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 rounded-lg transition-colors border border-slate-700"
            >
              <Monitor className="w-3.5 h-3.5 text-emerald-400" />
              HDMI Kiosk View
            </Link>
            <Link
              href="/admin"
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 rounded-lg transition-colors border border-slate-700"
            >
              <LayoutDashboard className="w-3.5 h-3.5 text-blue-400" />
              Admin Portal
            </Link>
            <Link
              href="/print?kiosk_id=GITAM-SPK-001"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-md shadow-blue-600/30 transition-all hover:scale-[1.02]"
            >
              <Zap className="w-3.5 h-3.5" />
              Start Printing
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#0d253f] via-[#112f4e] to-slate-900 text-white pt-20 pb-28 px-4">
        {/* Subtle background glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-blue-500/10 blur-[120px] pointer-events-none rounded-full" />

        <div className="max-w-5xl mx-auto text-center relative z-10 space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/15 border border-blue-400/30 text-blue-300 text-xs font-semibold tracking-wide">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Next-Gen Smart Campus Infrastructure</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-white leading-tight">
            Campus Printing, <br className="hidden sm:inline" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-sky-300 to-indigo-300">
              Made Simple & Secure.
            </span>
          </h1>

          <p className="max-w-2xl mx-auto text-slate-300 text-base sm:text-lg font-normal leading-relaxed">
            {branding.primary_tagline} — No computer queues, no logins, no flash drives.
            Scan the kiosk QR, pay instantly via UPI, and collect your verified prints in seconds.
          </p>

          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/print?kiosk_id=GITAM-SPK-001"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-7 py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl shadow-xl shadow-blue-600/30 transition-all hover:scale-105"
            >
              <Printer className="w-4 h-4" />
              <span>Launch Mobile Print Flow</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </Link>

            <Link
              href="/kiosk/GITAM-SPK-001"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-slate-800/90 hover:bg-slate-700/90 text-slate-200 hover:text-white font-semibold text-sm rounded-xl border border-slate-700 transition-all"
            >
              <Monitor className="w-4 h-4 text-emerald-400" />
              <span>View Raspberry Pi HDMI Screen</span>
            </Link>
          </div>

          {/* Rate Highlights Badge */}
          <div className="pt-8 flex flex-wrap items-center justify-center gap-4 text-xs font-medium text-slate-300">
            <div className="bg-slate-800/80 border border-slate-700 px-4 py-2 rounded-xl flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span>B&W Pages: <strong>₹{pricing.bw_price_per_page}/page</strong></span>
            </div>
            <div className="bg-slate-800/80 border border-slate-700 px-4 py-2 rounded-xl flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-sky-400"></span>
              <span>Color Pages: <strong>₹{pricing.color_price_per_page}/page</strong></span>
            </div>
            <div className="bg-slate-800/80 border border-slate-700 px-4 py-2 rounded-xl flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-amber-400" />
              <span>Zero-Retention File Privacy</span>
            </div>
          </div>
        </div>
      </section>

      {/* Campus Kiosk Status Strip */}
      <section className="-mt-12 max-w-5xl mx-auto px-4 w-full z-20">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200/80 p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200/60">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                01
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">GITAM-SPK-001 (Main Library)</h4>
                <p className="text-xs text-slate-500">HP LaserJet Pro USB • Fast Print</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              READY
            </span>
          </div>

          <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200/60">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                02
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">GITAM-SPK-002 (ICT Bhavan)</h4>
                <p className="text-xs text-slate-500">Engineering Corridor • Ready for Print</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              READY
            </span>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 px-4 max-w-6xl mx-auto w-full">
        <div className="text-center space-y-3 mb-14">
          <h2 className="text-xs font-bold text-blue-600 uppercase tracking-widest">
            Streamlined Campus Workflow
          </h2>
          <h3 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            How GITAM SMARTPRINT Works
          </h3>
          <p className="text-sm text-slate-500 max-w-lg mx-auto">
            Engineered from ground up for maximum student privacy and instant printing without queues.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            {
              step: '01',
              title: 'SCAN',
              desc: 'Scan the kiosk QR code using your phone camera.',
              icon: QrCode,
              color: 'text-blue-600 bg-blue-50 border-blue-100',
            },
            {
              step: '02',
              title: 'UPLOAD',
              desc: 'Upload your document from your phone browser.',
              icon: UploadCloud,
              color: 'text-indigo-600 bg-indigo-50 border-indigo-100',
            },
            {
              step: '03',
              title: 'PAY',
              desc: 'Pay securely using UPI (Google Pay, PhonePe, Paytm).',
              icon: CreditCard,
              color: 'text-emerald-600 bg-emerald-50 border-emerald-100',
            },
            {
              step: '04',
              title: 'PRINT',
              desc: 'Collect your document directly from the kiosk tray.',
              icon: Printer,
              color: 'text-amber-600 bg-amber-50 border-amber-100',
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.step}
                className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-mono text-sm font-black text-blue-600 bg-blue-50 border border-blue-200/60 px-2.5 py-1 rounded-lg">
                      {item.step}
                    </span>
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center border ${item.color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                  </div>
                  <h4 className="text-lg font-black text-slate-900 mb-1">{item.title}</h4>
                  <p className="text-xs text-slate-500 leading-relaxed font-medium">{item.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Security & Zero Retention Showcase */}
      <section className="bg-[#0d253f] text-white py-16 px-4">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold">
              <Shield className="w-3.5 h-3.5" />
              <span>Bank-Grade Document Privacy</span>
            </div>
            <h3 className="text-3xl font-extrabold tracking-tight">
              Customer Documents Are Ephemeral.
            </h3>
            <p className="text-slate-300 text-sm leading-relaxed">
              We never permanently store student documents. Our automated lifecycle strictly follows:
            </p>
            <div className="space-y-2.5 text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Private temporary storage with 60-second short-lived download authorization</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Downloaded locally only to restricted directory <code className="text-sky-300">/var/lib/smartprint/jobs</code></span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Immediate secure binary overwriting (<code className="text-sky-300">shred</code>) upon CUPS print confirmation</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Database storage path permanently nullified — only audit metadata is retained</span>
              </div>
            </div>
          </div>

          {/* Interactive Price Estimator Card */}
          <div className="bg-slate-900/90 rounded-2xl p-6 border border-slate-700/80 shadow-2xl space-y-5">
            <h4 className="text-base font-bold text-white flex items-center justify-between">
              <span>Instant Price Estimator</span>
              <span className="text-xs text-slate-400 font-normal">Real-time Rates</span>
            </h4>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1.5 font-medium">Number of Pages: {calcPages}</label>
                <input
                  type="range"
                  min="1"
                  max="50"
                  value={calcPages}
                  onChange={(e) => setCalcPages(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1.5 font-medium">Number of Copies: {calcCopies}</label>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={calcCopies}
                  onChange={(e) => setCalcCopies(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-slate-300 font-medium">Print Color Mode</span>
                <div className="flex rounded-lg overflow-hidden border border-slate-700">
                  <button
                    onClick={() => setCalcColor(false)}
                    className={`px-3 py-1 text-xs font-semibold ${
                      !calcColor ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    B&W (₹{pricing.bw_price_per_page})
                  </button>
                  <button
                    onClick={() => setCalcColor(true)}
                    className={`px-3 py-1 text-xs font-semibold ${
                      calcColor ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    Color (₹{pricing.color_price_per_page})
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-slate-400">Total Payable Amount</div>
                  <div className="text-2xl font-black text-white">₹{estimatedTotal.toFixed(2)}</div>
                </div>
                <Link
                  href="/print?kiosk_id=GITAM-SPK-001"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition-all shadow-md"
                >
                  Print Document Now
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Student FAQ */}
      <section className="py-20 px-4 max-w-4xl mx-auto w-full">
        <div className="text-center space-y-2 mb-12">
          <h2 className="text-xs font-bold text-blue-600 uppercase tracking-widest">
            Frequently Asked Questions
          </h2>
          <h3 className="text-2xl font-bold text-slate-900">Got Questions About SmartPrint?</h3>
        </div>

        <div className="space-y-3">
          {[
            {
              q: 'Do I need to install an app or register an account?',
              a: 'No. GITAM SMARTPRINT works directly in any mobile web browser. Simply scan the QR code on the kiosk monitor, upload your file, pay via UPI, and your document prints automatically.',
            },
            {
              q: 'Is my uploaded file safe and private?',
              a: 'Yes, completely. Files are stored in private temporary storage with strict access control. As soon as the HP printer completes physical printing, the file is securely shredded from the Raspberry Pi and permanently deleted from the cloud.',
            },
            {
              q: 'What payment modes are supported?',
              a: 'All standard Indian UPI apps are supported including Google Pay, PhonePe, Paytm, BHIM, as well as debit/credit cards through Razorpay.',
            },
            {
              q: 'What if a print fails or gets jammed?',
              a: 'The system detects CUPS job errors and notifies the admin dashboard. In case of paper jam or physical error, your job enters recovery status. Call support at 9006496970 for instant operator assistance.',
            },
          ].map((item, idx) => (
            <div key={idx} className="bg-white rounded-xl p-4 border border-slate-200/80 shadow-sm">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-1">
                <HelpCircle className="w-4 h-4 text-blue-600" />
                {item.q}
              </h4>
              <p className="text-xs text-slate-600 pl-6 leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Global Configurable Footer */}
      <Footer
        organization={branding.organization}
        product={branding.product}
        tagline={branding.primary_tagline}
        supportNumber={branding.support_number}
        poweredBy={branding.powered_by}
      />
    </div>
  );
}
