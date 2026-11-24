'use client';

import React, { use } from 'react';
import CustomerPrintApp from '@/components/print/CustomerPrintApp';

export default function KioskSpecificPrintPage({
  params,
}: {
  params: Promise<{ orgSlug: string; kioskSlug: string }>;
}) {
  const resolved = use(params);
  return (
    <CustomerPrintApp
      orgSlug={resolved.orgSlug}
      kioskSlug={resolved.kioskSlug}
    />
  );
}
