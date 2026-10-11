'use client';

import React, { use } from 'react';
import CustomerPrintPage from '../../page';

export default function KioskSpecificPrintPage({
  params,
}: {
  params: Promise<{ orgSlug: string; kioskSlug: string }>;
}) {
  const resolved = use(params);
  return (
    <CustomerPrintPage
      orgSlug={resolved.orgSlug}
      kioskSlug={resolved.kioskSlug}
    />
  );
}
