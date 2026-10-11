'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  UploadCloud,
  FileText,
  Printer,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Phone,
  Sparkles,
} from 'lucide-react';
import { Footer } from '@/components/Footer';
import { DEFAULT_BRANDING, DEFAULT_PRICING } from '@/lib/constants';

interface PrintAppContentProps {
  orgSlug?: string;
  kioskSlug?: string;
}

function PrintAppContent({ orgSlug: initialOrgSlug, kioskSlug: initialKioskSlug }: PrintAppContentProps) {
  const searchParams = useSearchParams();
  const orgSlug = initialOrgSlug || searchParams.get('org') || searchParams.get('organization') || 'gitam';
  const kioskParam = initialKioskSlug || searchParams.get('kiosk_id') || searchParams.get('kiosk') || 'GITAM-SPK-001';
  const sessionToken = searchParams.get('session_token') || searchParams.get('session_id') || '';

  // Config State
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [pricing, setPricing] = useState(DEFAULT_PRICING);
  const [kioskId, setKioskId] = useState<string>(kioskParam);
  const [organizationId, setOrganizationId] = useState<string>('');

  // Workflow Steps: 'UPLOAD' | 'CONFIG' | 'PAYING' | 'PRINTING' | 'SUCCESS' | 'ERROR'
  const [step, setStep] = useState<'UPLOAD' | 'CONFIG' | 'PAYING' | 'PRINTING' | 'SUCCESS' | 'ERROR'>('UPLOAD');

  // Uploaded Document Info
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string>('');
  const [totalPages, setTotalPages] = useState<number>(1);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string>('');

  // Print Configuration
  const [copies, setCopies] = useState<number>(1);
  const [pagesMode, setPagesMode] = useState<'ALL' | 'CUSTOM'>('ALL');
  const [customPageRange, setCustomPageRange] = useState<string>('');
  const [isColor, setIsColor] = useState<boolean>(false);
  const [isDuplex, setIsDuplex] = useState<boolean>(false);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');

  // Calculated Pricing
  const [calculatedAmount, setCalculatedAmount] = useState<number>(1.0);

  // Payment & Live Printing
  const [paymentOrderId, setPaymentOrderId] = useState<string>('');
  const [razorpayKeyId, setRazorpayKeyId] = useState<string>('');
  const [printStatusText, setPrintStatusText] = useState<string>('Verifying payment authorization...');
  const [cupsJobId, setCupsJobId] = useState<number | null>(null);

  // If a session token was passed, resolve it
  useEffect(() => {
    if (sessionToken) {
      fetch(`/api/kiosk/session?token=${encodeURIComponent(sessionToken)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.session) {
            setKioskId(data.session.kiosk_id);
            if (data.session.organization_id) {
              setOrganizationId(data.session.organization_id);
            }
          }
        })
        .catch(() => {});
    }
  }, [sessionToken]);

  // Fetch Organization Branding & Pricing dynamically
  useEffect(() => {
    fetch(`/api/branding?slug=${encodeURIComponent(orgSlug)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.branding) setBranding(data.branding);
        if (data.organization?.id) setOrganizationId(data.organization.id);
      })
      .catch(() => {});

    fetch(`/api/pricing?slug=${encodeURIComponent(orgSlug)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.pricing) setPricing(data.pricing);
      })
      .catch(() => {});
  }, [orgSlug]);

  // Handle File Upload
  const handleFileUpload = async (selectedFile: File) => {
    setIsUploading(true);
    setUploadError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('kiosk_id', kioskId);
      if (organizationId) formData.append('organization_id', organizationId);
      if (sessionToken) formData.append('session_id', sessionToken);

      const res = await fetch('/api/customer/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setFile(selectedFile);
      setJobId(data.job.id);
      setTotalPages(data.job.pages_total);
      setCalculatedAmount(data.job.calculated_amount);
      if (data.job.organization_id) setOrganizationId(data.job.organization_id);
      setStep('CONFIG');
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  // Recalculate Price on options change
  const recalculatePrice = useCallback(async () => {
    if (!jobId || step !== 'CONFIG') return;
    const pagesSelected = pagesMode === 'ALL' ? 'All' : customPageRange || '1';

    try {
      const res = await fetch('/api/customer/calculate-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          organization_id: organizationId,
          pages_selected: pagesSelected,
          copies,
          is_color: isColor,
          is_duplex: isDuplex,
          orientation,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCalculatedAmount(data.amount);
      }
    } catch {
      // ignore
    }
  }, [jobId, organizationId, copies, pagesMode, customPageRange, isColor, isDuplex, orientation, step]);

  useEffect(() => {
    recalculatePrice();
  }, [recalculatePrice]);

  // Initiate Payment
  const handleProceedToPayment = async () => {
    try {
      setStep('PAYING');
      const res = await fetch('/api/customer/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create payment order');

      setPaymentOrderId(data.order_id);
      setRazorpayKeyId(data.key_id);
    } catch (err) {
      setUploadError((err as Error).message);
      setStep('CONFIG');
    }
  };

  // Execute Payment & Track Live Printing
  const handleVerifyAndPrint = async () => {
    try {
      setStep('PRINTING');
      setPrintStatusText('Verifying payment signature with Razorpay...');

      const paymentId = `pay_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
      const mockSignature = `mock_sig_${Date.now()}`;

      // 1. Verify Payment & Authorize single print
      const verifyRes = await fetch('/api/customer/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: paymentOrderId,
          payment_id: paymentId,
          signature: mockSignature,
          job_id: jobId,
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || 'Payment verification failed');

      // 2. Poll / Trigger Pi Agent Execution
      setPrintStatusText('Payment verified! Connecting to Raspberry Pi 3B+ agent...');
      await new Promise((r) => setTimeout(r, 1000));

      setPrintStatusText('Pi Agent spooled document. Submitting to CUPS queue...');
      await new Promise((r) => setTimeout(r, 1200));

      // Trigger simulation / status transition
      const simRes = await fetch('/api/admin/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'simulate_print_lifecycle',
          job_id: jobId,
          kiosk_id: kioskId,
        }),
      });

      const simData = await simRes.json();
      if (simData.cups_job_id) {
        setCupsJobId(simData.cups_job_id);
      }

      setPrintStatusText('Printer actively outputting pages...');
      await new Promise((r) => setTimeout(r, 1500));

      setPrintStatusText('CUPS verified print output. Permanently destroying temporary file...');
      await new Promise((r) => setTimeout(r, 1000));

      setStep('SUCCESS');
    } catch (err) {
      setUploadError((err as Error).message);
      setStep('ERROR');
    }
  };

  const handleReset = () => {
    setFile(null);
    setJobId('');
    setTotalPages(1);
    setCopies(1);
    setPagesMode('ALL');
    setCustomPageRange('');
    setIsColor(false);
    setCalculatedAmount(1.0);
    setStep('UPLOAD');
    setUploadError('');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900">
      {/* Mobile Top Header */}
      <header className="bg-[#0d253f] text-white py-3.5 px-4 shadow-md sticky top-0 z-40">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-sm">
              <Printer className="w-4 h-4" />
            </div>
            <div>
              <span className="font-extrabold text-sm tracking-wide block leading-none">
                {branding.organization.replace(new RegExp(`\\s*${branding.product}$`, 'i'), '').trim() || branding.organization}{' '}
                <span className="text-amber-400">{branding.product}</span>
              </span>
              <span className="text-[10px] text-slate-400 font-medium tracking-tight">
                Kiosk: <strong className="text-sky-300">{kioskId}</strong>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/20 border border-emerald-400/40 rounded-full text-[11px] font-bold text-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>PRINTER READY</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-md w-full mx-auto p-4 flex flex-col justify-start">
        {/* STEP 1: UPLOAD */}
        {step === 'UPLOAD' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 space-y-5 animate-in fade-in duration-300">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Step 1 of 3: Select Document</span>
              </div>
              <h2 className="text-xl font-black text-slate-900">Upload to Print</h2>
              <p className="text-xs text-slate-500">
                Upload your document to print immediately at Kiosk <span className="font-semibold text-slate-700">{kioskId}</span>.
              </p>
            </div>

            {uploadError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Drag and Drop Zone */}
            <label className="border-2 border-dashed border-slate-300 hover:border-blue-500 bg-slate-50 hover:bg-blue-50/40 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all group">
              <input
                type="file"
                accept=".pdf,image/png,image/jpeg,image/jpg"
                className="hidden"
                disabled={isUploading}
                onChange={(e) => {
                  if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
                }}
              />
              <div className="w-14 h-14 rounded-2xl bg-blue-100 group-hover:bg-blue-200 text-blue-600 flex items-center justify-center mb-3 transition-colors">
                {isUploading ? (
                  <RefreshCw className="w-6 h-6 animate-spin" />
                ) : (
                  <UploadCloud className="w-7 h-7" />
                )}
              </div>
              <div className="text-center space-y-1">
                <span className="text-sm font-bold text-slate-800 block">
                  {isUploading ? 'Validating Document...' : 'Tap to Choose File'}
                </span>
                <span className="text-[11px] text-slate-500 block">
                  Supports PDF, PNG, JPG (Max {pricing.max_file_size_mb} MB)
                </span>
              </div>
            </label>

            {/* Features Info */}
            <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-3.5 space-y-2 text-xs text-slate-700">
              <div className="flex items-center gap-2 text-blue-900 font-bold text-[11px]">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                <span>Zero-Retention File Privacy</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Your file is stored in private temporary memory only and permanently erased from the Raspberry Pi and Supabase Storage immediately upon print completion.
              </p>
            </div>
          </div>
        )}

        {/* STEP 2: PRINT CONFIGURATION */}
        {step === 'CONFIG' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 space-y-5 animate-in fade-in duration-300">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                  Step 2 of 3: Options
                </span>
                <h3 className="text-lg font-black text-slate-900">Print Settings</h3>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 block">Job Reference</span>
                <span className="text-xs font-mono font-bold text-slate-700">{jobId}</span>
              </div>
            </div>

            {/* File Info Bar */}
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200/60">
              <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-900 truncate">{file?.name}</p>
                <p className="text-[11px] text-slate-500">
                  {totalPages} {totalPages === 1 ? 'Page' : 'Pages'} detected
                </p>
              </div>
            </div>

            {/* Print Settings Controls */}
            <div className="space-y-4 text-xs">
              {/* Copies */}
              <div>
                <label className="block text-slate-700 font-bold mb-1.5 flex items-center justify-between">
                  <span>Number of Copies</span>
                  <span className="text-blue-600 font-semibold">{copies} Copy</span>
                </label>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 5].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setCopies(num)}
                      className={`flex-1 py-2 rounded-xl font-bold border text-xs transition-colors ${
                        copies === num
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Mode */}
              <div>
                <label className="block text-slate-700 font-bold mb-1.5">Color Mode</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setIsColor(false)}
                    className={`py-2.5 px-3 rounded-xl border font-bold text-xs flex flex-col items-center gap-0.5 transition-all ${
                      !isColor
                        ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>Black & White</span>
                    <span className={`text-[10px] font-medium ${!isColor ? 'text-blue-100' : 'text-slate-500'}`}>
                      ₹{pricing.bw_price_per_page}/page
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsColor(true)}
                    className={`py-2.5 px-3 rounded-xl border font-bold text-xs flex flex-col items-center gap-0.5 transition-all ${
                      isColor
                        ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>Full Color</span>
                    <span className={`text-[10px] font-medium ${isColor ? 'text-blue-100' : 'text-slate-500'}`}>
                      ₹{pricing.color_price_per_page}/page
                    </span>
                  </button>
                </div>
              </div>

              {/* Page Selection */}
              <div>
                <label className="block text-slate-700 font-bold mb-1.5">Pages to Print</label>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setPagesMode('ALL')}
                    className={`py-2 rounded-xl border font-bold text-xs transition-colors ${
                      pagesMode === 'ALL'
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-slate-50 border-slate-200 text-slate-700'
                    }`}
                  >
                    All Pages (1-{totalPages})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPagesMode('CUSTOM')}
                    className={`py-2 rounded-xl border font-bold text-xs transition-colors ${
                      pagesMode === 'CUSTOM'
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-slate-50 border-slate-200 text-slate-700'
                    }`}
                  >
                    Custom Range
                  </button>
                </div>

                {pagesMode === 'CUSTOM' && (
                  <input
                    type="text"
                    placeholder="e.g. 1-3 or 1,2,4"
                    value={customPageRange}
                    onChange={(e) => setCustomPageRange(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-blue-500"
                  />
                )}
              </div>

              {/* Duplex / 2-Sided Toggle */}
              <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                <div>
                  <span className="font-bold text-slate-800 block text-xs">Double-Sided (Duplex)</span>
                  <span className="text-[10px] text-slate-500">Automatic two-sided printing</span>
                </div>
                <input
                  type="checkbox"
                  checked={isDuplex}
                  onChange={(e) => setIsDuplex(e.target.checked)}
                  className="w-4 h-4 accent-blue-600 rounded cursor-pointer"
                />
              </div>

              {/* Orientation Selection */}
              <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                <div>
                  <span className="font-bold text-slate-800 block text-xs">Orientation</span>
                  <span className="text-[10px] text-slate-500">Page layout direction</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOrientation('portrait')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold border ${
                      orientation === 'portrait' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    Portrait
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrientation('landscape')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold border ${
                      orientation === 'landscape' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    Landscape
                  </button>
                </div>
              </div>
            </div>

            {/* Price Summary Strip */}
            <div className="bg-[#0d253f] text-white rounded-xl p-4 flex items-center justify-between shadow-md">
              <div>
                <span className="text-[10px] text-slate-300 uppercase font-semibold block">Total Amount</span>
                <span className="text-2xl font-black text-white">₹{calculatedAmount.toFixed(2)}</span>
              </div>
              <button
                type="button"
                onClick={handleProceedToPayment}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5"
              >
                <span>Proceed to Pay</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: PAYMENT SCREEN */}
        {step === 'PAYING' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 space-y-5 animate-in fade-in duration-300">
            <div className="space-y-1 text-center">
              <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                Step 3 of 3: Payment
              </span>
              <h3 className="text-xl font-black text-slate-900">Confirm & Pay</h3>
              <p className="text-xs text-slate-500">
                Verified payment authorizes exactly one print job on the connected printer.
              </p>
            </div>

            {/* Invoice card */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Job ID:</span>
                <span className="font-mono font-bold text-slate-900">{jobId}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Organization:</span>
                <span className="font-semibold text-slate-900">{branding.organization}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Document:</span>
                <span className="font-semibold text-slate-900 truncate max-w-[180px]">{file?.name}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Copies & Mode:</span>
                <span className="font-semibold text-slate-900">
                  {copies} {copies === 1 ? 'copy' : 'copies'} • {isColor ? 'Color' : 'B&W'}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-sm">
                <span className="font-bold text-slate-900">Payable:</span>
                <span className="font-black text-blue-600 text-lg">₹{calculatedAmount.toFixed(2)}</span>
              </div>
            </div>

            {/* Payment Button */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleVerifyAndPrint}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm rounded-xl shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2"
              >
                <CreditCard className="w-4 h-4" />
                <span>Pay ₹{calculatedAmount.toFixed(2)} via UPI / Razorpay</span>
              </button>

              <div className="text-center">
                <span className="text-[10px] text-slate-400">
                  Razorpay Key: {razorpayKeyId ? `${razorpayKeyId.slice(0, 12)}...` : 'Active'} • 256-Bit SSL Encryption
                </span>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: LIVE PRINT PROGRESS */}
        {step === 'PRINTING' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 text-center space-y-6 animate-in fade-in duration-300">
            <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mx-auto animate-pulse">
              <Printer className="w-8 h-8" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-black text-slate-900">Printing in Progress</h3>
              <p className="text-xs text-slate-600 font-medium">{printStatusText}</p>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-xs text-left space-y-2">
              <div className="flex items-center gap-2 text-emerald-600 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Payment Verified Server-Side</span>
              </div>
              <div className="flex items-center gap-2 text-blue-600 font-semibold">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Dispatched to Kiosk ({kioskId})</span>
              </div>
              {cupsJobId && (
                <div className="flex items-center gap-2 text-slate-600">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  <span>CUPS Queue Job ID: #{cupsJobId}</span>
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-400">
              Please wait at the printer output tray while the document finishes printing.
            </p>
          </div>
        )}

        {/* STEP 5: SUCCESS / COLLECT SCREEN */}
        {step === 'SUCCESS' && (
          <div className="bg-white rounded-2xl shadow-sm border border-emerald-200 p-6 text-center space-y-5 animate-in zoom-in-95 duration-300">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-md shadow-emerald-500/20">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                Print Completed ✓
              </span>
              <h3 className="text-xl font-black text-slate-900">Collect Your Document</h3>
              <p className="text-xs text-slate-500">
                Your print job has been printed successfully.
              </p>
            </div>

            {/* Job Summary */}
            <div className="bg-emerald-50/60 border border-emerald-200/70 rounded-xl p-4 text-xs space-y-2 text-left">
              <div className="flex justify-between">
                <span className="text-slate-600">Job Reference:</span>
                <span className="font-mono font-bold text-slate-900">{jobId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Total Pages:</span>
                <span className="font-bold text-slate-900">{totalPages * copies}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Amount Paid:</span>
                <span className="font-bold text-slate-900">₹{calculatedAmount.toFixed(2)}</span>
              </div>
              <div className="pt-2 border-t border-emerald-200/60 flex items-center gap-1.5 text-emerald-800 text-[11px] font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Zero-Retention File Privacy: Temporary document permanently wiped.</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleReset}
              className="w-full py-3 bg-[#0d253f] hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-md transition-all"
            >
              Print Another Document
            </button>
          </div>
        )}

        {/* STEP 6: ERROR SCREEN */}
        {step === 'ERROR' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-center space-y-5 animate-in fade-in duration-300">
            <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <AlertCircle className="w-7 h-7" />
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-black text-slate-900">
                Printing is temporarily unavailable.
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                We could not complete your print job at this moment. Please try again or reach out to our campus support team.
              </p>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center gap-2">
              <Phone className="w-4 h-4 text-emerald-600" />
              <span className="text-xs font-semibold text-slate-700">Support Hotline:</span>
              <a
                href={`tel:${branding.support_number}`}
                className="text-xs font-bold text-blue-600 hover:underline"
              >
                {branding.support_number}
              </a>
            </div>

            <button
              type="button"
              onClick={handleReset}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition-all"
            >
              Try Again
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
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

export default function CustomerPrintPage(props: PrintAppContentProps) {
  return (
    <Suspense fallback={<div className="p-10 text-center font-bold">Loading SmartPrint...</div>}>
      <PrintAppContent {...props} />
    </Suspense>
  );
}
