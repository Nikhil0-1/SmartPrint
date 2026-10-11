'use client';

import React from 'react';
import { Phone, ShieldCheck, Cpu } from 'lucide-react';
import { DEFAULT_BRANDING } from '@/lib/constants';

interface FooterProps {
  organization?: string;
  product?: string;
  tagline?: string;
  supportNumber?: string;
  poweredBy?: string;
}

export function Footer({
  organization = DEFAULT_BRANDING.organization,
  product = DEFAULT_BRANDING.product,
  tagline = DEFAULT_BRANDING.primary_tagline,
  supportNumber = DEFAULT_BRANDING.support_number,
  poweredBy = DEFAULT_BRANDING.powered_by,
}: FooterProps) {
  const displayOrg = organization.replace(new RegExp(`\\s*${product}$`, 'i'), '').trim() || organization;

  return (
    <footer className="w-full bg-[#0d253f] text-slate-300 py-8 px-4 border-t border-slate-800">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        {/* Brand info */}
        <div className="text-center md:text-left space-y-1">
          <div className="flex items-center justify-center md:justify-start gap-2">
            <span className="font-extrabold text-white text-lg tracking-wide">
              {displayOrg} <span className="text-amber-400">{product}</span>
            </span>
            <span className="bg-blue-600 text-[10px] font-bold text-white px-2 py-0.5 rounded-full">
              SECURE KIOSK
            </span>
          </div>
          <p className="text-xs text-slate-400 font-medium tracking-wider">{tagline}</p>
        </div>

        {/* Support Callout */}
        <div className="flex items-center gap-3 bg-slate-900/80 border border-slate-700/60 rounded-xl px-4 py-2.5 shadow-sm">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
            <Phone className="w-4 h-4" />
          </div>
          <div className="text-left">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              For Enquiry & Support
            </div>
            <a
              href={`tel:${supportNumber}`}
              className="text-sm font-bold text-white hover:text-blue-400 transition-colors tracking-wide"
            >
              {supportNumber}
            </a>
          </div>
        </div>

        {/* Powered by & Privacy */}
        <div className="text-center md:text-right space-y-1 text-xs text-slate-400">
          <div className="flex items-center justify-center md:justify-end gap-1.5 text-slate-300 font-medium">
            <Cpu className="w-3.5 h-3.5 text-blue-400" />
            <span>Powered by <strong className="text-white">{poweredBy}</strong></span>
          </div>
          <div className="flex items-center justify-center md:justify-end gap-1 text-[11px] text-slate-400">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            <span>Ephemeral File Security • Auto-Deleted After Print</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
