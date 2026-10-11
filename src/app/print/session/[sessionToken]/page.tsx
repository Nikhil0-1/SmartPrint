'use client';

import React, { useEffect, use } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Session Redirect Page — /print/session/[sessionToken]
 *
 * The kiosk QR code encodes a URL like:
 *   https://your-domain.com/print/session/sess_abc123_1234567890
 *
 * This page validates the session token exists on the server and redirects
 * the customer to /print with the session context embedded.
 *
 * The session_token is forwarded as a query param so the print page can:
 * 1. Resolve it via /api/kiosk/session to get the kiosk_id
 * 2. Bind the upload and payment to that specific kiosk session
 */
export default function SessionRedirectPage({
  params,
}: {
  params: Promise<{ sessionToken: string }>;
}) {
  const router = useRouter();
  const resolvedParams = use(params);
  const sessionToken = resolvedParams.sessionToken;

  useEffect(() => {
    if (!sessionToken) {
      router.replace('/print');
      return;
    }

    // Redirect to the print workflow, passing the session token so the
    // print page can resolve the kiosk_id and bind the session.
    router.replace(`/print?session_token=${encodeURIComponent(sessionToken)}`);
  }, [sessionToken, router]);

  return (
    <div className="min-h-screen bg-[#0d253f] text-white flex items-center justify-center p-4 font-sans text-center">
      <div className="space-y-4">
        <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto" />
        <div>
          <p className="text-base font-bold text-slate-200">Starting Secure Print Session...</p>
          <p className="text-xs text-slate-400 mt-1">Connecting to GITAM SMARTPRINT</p>
        </div>
        <div className="text-[10px] font-mono text-slate-600 mt-2 px-2 py-1 bg-slate-900/60 rounded">
          session: {sessionToken ? `${sessionToken.substring(0, 12)}...` : 'none'}
        </div>
      </div>
    </div>
  );
}
