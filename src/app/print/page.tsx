'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import Script from 'next/script';
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
  Clock,
  Users,
  Layers,
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
  const [isCalculating, setIsCalculating] = useState<boolean>(false);

  // Payment & Live Printing
  const [paymentOrderId, setPaymentOrderId] = useState<string>('');
  const [razorpayKeyId, setRazorpayKeyId] = useState<string>('');
  const [isPaymentProcessing, setIsPaymentProcessing] = useState<boolean>(false);

  // Live FIFO Queue State
  const [customerAccessToken, setCustomerAccessToken] = useState<string>('');
  const [queuePosition, setQueuePosition] = useState<number>(1);
  const [jobsAhead, setJobsAhead] = useState<number>(0);
  const [assignedPrinterName, setAssignedPrinterName] = useState<string>('Assigned Printer');
  const [liveQueueStatus, setLiveQueueStatus] = useState<string>('Your document has been added to the print queue.');
  const [estimatedWaitSec, setEstimatedWaitSec] = useState<number>(0);

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
        throw new Error(data.error || 'Document upload failed. Please try again.');
      }

      setFile(selectedFile);
      // Upload API returns { jobs: [{jobId, fileName, pages, amount_rupees}], total_amount }
      const firstJob = data.jobs?.[0];
      if (!firstJob) throw new Error('Upload succeeded but no job was created.');
      setJobId(firstJob.jobId);
      setTotalPages(firstJob.pages || 1);
      setCalculatedAmount(data.total_amount || firstJob.amount_rupees || 1.0);
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
    setIsCalculating(true);

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
      if (data.success && typeof data.amount === 'number') {
        setCalculatedAmount(data.amount);
      }
    } catch {
      // Fallback local computation if network fails
      const rate = isColor ? pricing.color_price_per_page : pricing.bw_price_per_page;
      const count = pagesMode === 'ALL' ? totalPages : 1;
      setCalculatedAmount(Math.max(1, count * copies * rate));
    } finally {
      setIsCalculating(false);
    }
  }, [jobId, organizationId, copies, pagesMode, customPageRange, isColor, isDuplex, orientation, step, pricing, totalPages]);

  useEffect(() => {
    recalculatePrice();
  }, [recalculatePrice]);

  // Initiate Payment - Server-Side Razorpay Order Creation
  const handleProceedToPayment = async () => {
    try {
      setIsPaymentProcessing(true);
      setUploadError('');

      const res = await fetch('/api/customer/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initialize payment gateway.');

      setPaymentOrderId(data.order_id);
      setRazorpayKeyId(data.key_id);
      if (data.customer_access_token) {
        setCustomerAccessToken(data.customer_access_token);
      }
      if (data.printer_assigned) {
        setAssignedPrinterName(data.printer_assigned);
      }
      setStep('PAYING');
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setIsPaymentProcessing(false);
    }
  };

  // Server-side Payment Verification and FIFO Queue Polling
  const executeVerificationWithServer = async (
    orderId: string,
    paymentId: string,
    signature: string
  ) => {
    try {
      setStep('PRINTING');
      setLiveQueueStatus('Verifying payment authorization with server...');

      const verifyRes = await fetch('/api/customer/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: orderId,
          payment_id: paymentId,
          signature: signature,
          job_id: jobId,
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'Payment verification could not be validated.');
      }

      const token = verifyData.customer_access_token || customerAccessToken;
      if (token) setCustomerAccessToken(token);

      setQueuePosition(verifyData.queue_position || 1);
      setJobsAhead(verifyData.jobs_ahead || 0);
      if (verifyData.printer_name) setAssignedPrinterName(verifyData.printer_name);
      setLiveQueueStatus(verifyData.status_label || 'Your document has been added to the print queue.');
      if (verifyData.estimated_wait_seconds !== undefined) {
        setEstimatedWaitSec(verifyData.estimated_wait_seconds);
      }

      // Start FIFO queue status polling
      let pollCount = 0;
      const maxPolls = 180; // Up to 6 minutes of monitoring
      const pollTimer = setInterval(async () => {
        pollCount++;
        try {
          const qRes = await fetch(
            `/api/customer/queue-status?job_id=${encodeURIComponent(jobId)}&token=${encodeURIComponent(token || '')}`
          );
          if (qRes.ok) {
            const qData = await qRes.json();
            if (qData.success) {
              setQueuePosition(qData.queue_position);
              setJobsAhead(qData.jobs_ahead);
              if (qData.printer_name) setAssignedPrinterName(qData.printer_name);
              setLiveQueueStatus(qData.status_label);
              if (qData.estimated_wait_seconds !== undefined) {
                setEstimatedWaitSec(qData.estimated_wait_seconds);
              }

              if (qData.is_completed) {
                clearInterval(pollTimer);
                setStep('SUCCESS');
              } else if (qData.is_failed) {
                clearInterval(pollTimer);
                setUploadError(qData.error_message || 'Print processing failed. Please check printer or contact support.');
                setStep('ERROR');
              }
            }
          }
        } catch {
          // Network interruption — keep polling
        }

        if (pollCount >= maxPolls) {
          clearInterval(pollTimer);
        }
      }, 2000);
    } catch (err) {
      setUploadError((err as Error).message);
      setStep('ERROR');
    }
  };

  // Launch Razorpay Standard Checkout SDK Modal
  const handleLaunchRazorpayCheckout = () => {
    // If Razorpay window script is loaded and we have a valid key
    const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
    const RazorpayConstructor = win ? (win.Razorpay as new (opts: unknown) => { open: () => void; on: (e: string, cb: (res: unknown) => void) => void }) : null;

    if (RazorpayConstructor && razorpayKeyId) {
      if (razorpayKeyId.includes('gitam_smartprint') || razorpayKeyId.includes('placeholder')) {
        setUploadError('Payment gateway configuration required: Real Razorpay Key ID must be configured and verified in Admin Settings.');
        setStep('ERROR');
        return;
      }
      try {
        const options = {
          key: razorpayKeyId,
          amount: Math.round(calculatedAmount * 100),
          currency: 'INR',
          name: branding.organization || 'GITAM SMARTPRINT',
          description: `Self-Service Print (${copies} copy, ${isColor ? 'Color' : 'B&W'})`,
          order_id: paymentOrderId,
          handler: function (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) {
            executeVerificationWithServer(
              response.razorpay_order_id || paymentOrderId,
              response.razorpay_payment_id,
              response.razorpay_signature
            );
          },
          prefill: {
            contact: branding.support_number || '9006496970',
          },
          theme: {
            color: '#0d253f',
          },
          modal: {
            ondismiss: function () {
              // User dismissed modal
            },
          },
        };

        const rzp = new RazorpayConstructor(options);
        rzp.on('payment.failed', function (resp: unknown) {
          const failure = resp as { error?: { description?: string } };
          setUploadError(failure.error?.description || 'Payment was declined or cancelled.');
          setStep('ERROR');
        });
        rzp.open();
        return;
      } catch (err) {
        console.error('Razorpay SDK error:', err);
        setUploadError('Payment gateway could not be opened. Please reload or contact support.');
        setStep('ERROR');
        return;
      }
    }

    setUploadError('Payment gateway is loading. Please wait a moment and try again.');
    setStep('ERROR');
  };

  const handleReset = () => {
    setFile(null);
    setJobId('');
    setTotalPages(1);
    setCopies(1);
    setPagesMode('ALL');
    setCustomPageRange('');
    setIsColor(false);
    setIsDuplex(false);
    setCalculatedAmount(1.0);
    setStep('UPLOAD');
    setUploadError('');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 selection:bg-blue-600 selection:text-white">
      {/* Razorpay Checkout SDK Script */}
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />

      {/* Top Header - Postal Deep Navy */}
      <header className="bg-[#0d253f] text-white py-3 px-4 sm:px-6 shadow-md sticky top-0 z-40 border-b border-slate-800">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white shadow-sm">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <span className="font-extrabold text-sm sm:text-base tracking-wide block leading-tight">
                {branding.organization} <span className="text-amber-400">{branding.product}</span>
              </span>
              <span className="text-[11px] text-slate-400 font-medium">
                Kiosk: <strong className="text-sky-300 font-mono">{kioskId}</strong>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/15 border border-emerald-500/30 rounded-full text-[11px] font-bold text-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="hidden xs:inline">ONLINE</span>
            <span>READY</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-xl w-full mx-auto p-4 sm:p-6 flex flex-col justify-start">
        {/* STEP 1: UPLOAD */}
        {step === 'UPLOAD' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
            <div className="space-y-1.5 text-center sm:text-left">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Step 1: Upload Document</span>
              </div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">Print in Seconds</h1>
              <p className="text-xs text-slate-500">
                Upload your document to print immediately at Kiosk <span className="font-semibold text-slate-800 font-mono">{kioskId}</span>.
              </p>
            </div>

            {uploadError && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{uploadError}</span>
              </div>
            )}

            {/* Drag & Drop Zone */}
            <label className="border-2 border-dashed border-slate-300 hover:border-blue-500 bg-slate-50/70 hover:bg-blue-50/30 rounded-2xl p-8 sm:p-10 flex flex-col items-center justify-center cursor-pointer transition-all group">
              <input
                type="file"
                accept=".pdf,image/png,image/jpeg,image/jpg"
                className="hidden"
                disabled={isUploading}
                onChange={(e) => {
                  if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
                }}
              />
              <div className="w-16 h-16 rounded-2xl bg-blue-100 group-hover:bg-blue-200 text-blue-600 flex items-center justify-center mb-4 transition-colors shadow-sm">
                {isUploading ? (
                  <RefreshCw className="w-7 h-7 animate-spin text-blue-600" />
                ) : (
                  <UploadCloud className="w-8 h-8" />
                )}
              </div>
              <div className="text-center space-y-1">
                <span className="text-sm sm:text-base font-bold text-slate-800 block">
                  {isUploading ? 'Validating & Counting Pages...' : 'Tap or Drop Document Here'}
                </span>
                <span className="text-xs text-slate-500 block">
                  PDF, PNG, JPG (Max {pricing.max_file_size_mb} MB)
                </span>
              </div>
            </label>

            {/* Pricing Rates Bar */}
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <span className="text-[11px] font-semibold text-slate-500 block uppercase">Black & White</span>
                <span className="text-lg font-black text-slate-900">₹{pricing.bw_price_per_page}</span>
                <span className="text-[10px] text-slate-400 block">per page</span>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <span className="text-[11px] font-semibold text-slate-500 block uppercase">Full Colour</span>
                <span className="text-lg font-black text-slate-900">₹{pricing.color_price_per_page}</span>
                <span className="text-[10px] text-slate-400 block">per page</span>
              </div>
            </div>

            {/* Zero Retention Privacy Guarantee */}
            <div className="bg-blue-50/60 border border-blue-200/80 rounded-xl p-4 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-xs text-slate-700 space-y-0.5">
                <span className="font-bold text-blue-950 block">Verified Ephemeral Privacy</span>
                <p className="text-slate-600 leading-relaxed text-[11px]">
                  Your document is held only in private temporary memory and is permanently destroyed immediately after printing.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: PRINT CONFIGURATION */}
        {step === 'CONFIG' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                  Step 2: Print Settings
                </span>
                <h2 className="text-xl font-black text-slate-900">Configure Print</h2>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 block uppercase font-medium">Job Ref</span>
                <span className="text-xs font-mono font-bold text-slate-700">{jobId}</span>
              </div>
            </div>

            {/* File Info Bar */}
            <div className="flex items-center gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-900 truncate">{file?.name}</p>
                <p className="text-[11px] text-slate-500">
                  {totalPages} {totalPages === 1 ? 'Page' : 'Pages'} detected
                </p>
              </div>
            </div>

            {/* Options Form */}
            <div className="space-y-4 text-xs">
              {/* Copies */}
              <div>
                <label className="block text-slate-700 font-bold mb-1.5 flex items-center justify-between">
                  <span>Number of Copies</span>
                  <span className="text-blue-600 font-semibold">{copies} {copies === 1 ? 'copy' : 'copies'}</span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 5].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setCopies(num)}
                      className={`py-2 rounded-xl font-bold border text-xs transition-colors ${
                        copies === num
                          ? 'bg-[#0d253f] border-[#0d253f] text-white'
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
                <label className="block text-slate-700 font-bold mb-1.5">Color Preference</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setIsColor(false)}
                    className={`p-3 rounded-xl border font-bold text-xs flex flex-col items-center gap-0.5 transition-all ${
                      !isColor
                        ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>Black & White</span>
                    <span className={`text-[11px] font-medium ${!isColor ? 'text-blue-100' : 'text-slate-500'}`}>
                      ₹{pricing.bw_price_per_page}/page
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsColor(true)}
                    className={`p-3 rounded-xl border font-bold text-xs flex flex-col items-center gap-0.5 transition-all ${
                      isColor
                        ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>Full Colour</span>
                    <span className={`text-[11px] font-medium ${isColor ? 'text-blue-100' : 'text-slate-500'}`}>
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
              <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                <div>
                  <span className="font-bold text-slate-800 block text-xs">Double-Sided (Duplex)</span>
                  <span className="text-[11px] text-slate-500">Prints both sides when printer supports it</span>
                </div>
                <input
                  type="checkbox"
                  checked={isDuplex}
                  onChange={(e) => setIsDuplex(e.target.checked)}
                  className="w-5 h-5 accent-blue-600 rounded cursor-pointer"
                />
              </div>

              {/* Orientation */}
              <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                <div>
                  <span className="font-bold text-slate-800 block text-xs">Page Orientation</span>
                  <span className="text-[11px] text-slate-500">Direction of the layout</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOrientation('portrait')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                      orientation === 'portrait'
                        ? 'bg-[#0d253f] text-white border-[#0d253f]'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    Portrait
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrientation('landscape')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                      orientation === 'landscape'
                        ? 'bg-[#0d253f] text-white border-[#0d253f]'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    Landscape
                  </button>
                </div>
              </div>
            </div>

            {/* Price Breakdown Strip */}
            <div className="bg-[#0d253f] text-white rounded-xl p-4 flex items-center justify-between shadow-md">
              <div>
                <span className="text-[11px] text-slate-300 uppercase font-semibold block">Total Payable</span>
                <span className="text-2xl font-black text-white">
                  {isCalculating ? '...' : `₹${calculatedAmount.toFixed(2)}`}
                </span>
              </div>
              <button
                type="button"
                disabled={isPaymentProcessing}
                onClick={handleProceedToPayment}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-2 hover:scale-[1.02]"
              >
                {isPaymentProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Preparing Order...</span>
                  </>
                ) : (
                  <>
                    <span>Proceed to Pay</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: PAYMENT SCREEN */}
        {step === 'PAYING' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
            <div className="space-y-1 text-center">
              <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                Step 3: Secure Payment
              </span>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">Confirm & Pay</h2>
              <p className="text-xs text-slate-500">
                Payment verifies and immediately queues your print job on the connected printer.
              </p>
            </div>

            {/* Invoice Breakdown */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Job Reference:</span>
                <span className="font-mono font-bold text-slate-900">{jobId}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Destination Kiosk:</span>
                <span className="font-mono font-bold text-slate-900">{kioskId}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Assigned Printer:</span>
                <span className="font-semibold text-slate-900 truncate max-w-[200px]">{assignedPrinterName}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Print Spec:</span>
                <span className="font-semibold text-slate-900">
                  {totalPages} {totalPages === 1 ? 'page' : 'pages'} × {copies} {copies === 1 ? 'copy' : 'copies'} ({isColor ? 'Colour' : 'B&W'})
                </span>
              </div>
              <div className="pt-2.5 border-t border-slate-200 flex justify-between items-center text-sm">
                <span className="font-bold text-slate-900">Total Amount:</span>
                <span className="font-black text-blue-600 text-xl">₹{calculatedAmount.toFixed(2)}</span>
              </div>
            </div>

            {/* Payment Action Buttons */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleLaunchRazorpayCheckout}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm rounded-xl shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2.5 hover:scale-[1.01]"
              >
                <CreditCard className="w-4 h-4" />
                <span>Pay ₹{calculatedAmount.toFixed(2)} via UPI / Razorpay</span>
              </button>

              <div className="text-center space-y-1">
                <span className="text-[11px] text-slate-400 block">
                  256-Bit SSL Encrypted • Server-Verified Transaction • Idempotent Dispatch
                </span>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: LIVE PRINT PROGRESS & FIFO QUEUE WAITING EXPERIENCE */}
        {step === 'PRINTING' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200 mx-auto">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Payment Authorized Server-Side</span>
            </div>

            <div className="space-y-1">
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">Your Document is in Queue</h2>
              <p className="text-xs text-slate-500 font-medium">
                Enqueued in the printer&apos;s physical FIFO queue. Please do not close this window.
              </p>
            </div>

            {/* Live Queue Cards Grid */}
            <div className="grid grid-cols-2 gap-3 text-left">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex items-center gap-1.5 text-slate-500 text-[11px] font-semibold">
                  <Users className="w-4 h-4 text-blue-600" />
                  <span>Queue Position</span>
                </div>
                <div className="mt-1 font-black text-3xl text-blue-600">
                  #{queuePosition}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  {jobsAhead === 0 ? 'Next in line to print' : `${jobsAhead} ${jobsAhead === 1 ? 'job' : 'jobs'} ahead of you`}
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex items-center gap-1.5 text-slate-500 text-[11px] font-semibold">
                  <Printer className="w-4 h-4 text-indigo-600" />
                  <span>Assigned Printer</span>
                </div>
                <div className="mt-1 font-bold text-sm text-slate-900 truncate" title={assignedPrinterName}>
                  {assignedPrinterName}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  Kiosk: {kioskId}
                </div>
              </div>
            </div>

            {/* Status Details Box */}
            <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-4 text-xs text-left space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-blue-900 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                  <span>Queue Status:</span>
                </span>
                <span className="font-bold text-blue-700 bg-blue-100/80 px-2.5 py-0.5 rounded text-[11px]">
                  {liveQueueStatus}
                </span>
              </div>

              {estimatedWaitSec > 0 && (
                <div className="flex items-center gap-1.5 text-[11px] text-blue-800">
                  <Clock className="w-3.5 h-3.5 text-blue-600" />
                  <span>Estimated wait time: ~{estimatedWaitSec} seconds</span>
                </div>
              )}
            </div>

            <div className="pt-2 flex items-center justify-between text-[11px] text-slate-400 font-mono border-t border-slate-100">
              <span>Job: {jobId}</span>
              <span>Kiosk: {kioskId}</span>
            </div>
          </div>
        )}

        {/* STEP 5: SUCCESS / COLLECT SCREEN */}
        {step === 'SUCCESS' && (
          <div className="bg-white rounded-2xl shadow-sm border border-emerald-200 p-6 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-md shadow-emerald-500/20">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-widest">
                Print Completed ✓
              </span>
              <h2 className="text-2xl font-black text-slate-900">Collect Your Document</h2>
              <p className="text-xs text-slate-500">
                Your pages have finished printing. Please collect them from the printer output tray.
              </p>
            </div>

            {/* Job Summary */}
            <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-xl p-4 text-xs space-y-2.5 text-left">
              <div className="flex justify-between">
                <span className="text-slate-600">Job Reference:</span>
                <span className="font-mono font-bold text-slate-900">{jobId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Total Pages Printed:</span>
                <span className="font-bold text-slate-900">{totalPages * copies}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Total Paid:</span>
                <span className="font-bold text-slate-900">₹{calculatedAmount.toFixed(2)}</span>
              </div>
              <div className="pt-2 border-t border-emerald-200/60 flex items-center gap-2 text-emerald-800 text-[11px] font-medium">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Zero-Retention File Privacy: Temporary document securely and permanently wiped.</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleReset}
              className="w-full py-3.5 bg-[#0d253f] hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-md transition-all"
            >
              Print Another Document
            </button>
          </div>
        )}

        {/* STEP 6: ERROR SCREEN */}
        {step === 'ERROR' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-center space-y-6">
            <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <AlertCircle className="w-7 h-7" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-xl font-black text-slate-900">
                Printing Notice
              </h2>
              <p className="text-xs text-red-600 font-medium">
                {uploadError || 'Printing is temporarily unavailable at this kiosk.'}
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                If your payment was deducted, your print will be completed automatically or refunded. For instant assistance, please contact the campus support hotline below.
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center gap-3">
              <Phone className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-xs font-semibold text-slate-700">Support Hotline:</span>
              <a
                href={`tel:${branding.support_number}`}
                className="text-xs font-bold text-blue-600 hover:underline tracking-wide"
              >
                {branding.support_number}
              </a>
            </div>

            <button
              type="button"
              onClick={handleReset}
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition-all"
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
    <Suspense fallback={<div className="p-10 text-center font-bold text-slate-600">Loading GITAM SMARTPRINT...</div>}>
      <PrintAppContent {...props} />
    </Suspense>
  );
}
