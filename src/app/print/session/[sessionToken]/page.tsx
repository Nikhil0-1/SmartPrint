'use client';

import React, { useEffect, use } from 'react';
import { useRouter } from 'next/navigation';

export default function SessionRedirectPage({
  params,
}: {
  params: Promise<{ sessionToken: string }>;
}) {
  const router = useRouter();
  const resolvedParams = use(params);
  const sessionToken = resolvedParams.sessionToken;

  useEffect(() => {
    if (sessionToken) {
      router.replace(`/print?session_token=${encodeURIComponent(sessionToken)}`);
    } else {
      router.replace('/print');
    }
  }, [sessionToken, router]);

  return (
    <div className="min-h-screen bg-[#0d253f] text-white flex items-center justify-center p-4 font-sans text-center">
      <div className="space-y-3">
        <div className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="text-sm font-bold text-slate-200">Starting Secure Print Session...</p>
        <p className="text-xs text-slate-400">Connecting to GITAM SMARTPRINT Kiosk</p>
      </div>
    </div>
  );
}
