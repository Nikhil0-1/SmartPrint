'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function KioskDefaultRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/kiosk/GITAM-SPK-001');
  }, [router]);

  return (
    <div className="h-screen w-screen bg-[#0d253f] text-white flex items-center justify-center font-sans">
      <span className="text-sm font-bold tracking-wider">Loading GITAM SMARTPRINT Kiosk Screen...</span>
    </div>
  );
}
