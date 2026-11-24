'use client';

import React, { use } from 'react';
import CustomerPrintApp from '@/components/print/CustomerPrintApp';

export default function OrgSpecificPrintPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const resolved = use(params);
  return <CustomerPrintApp orgSlug={resolved.orgSlug} />;
}
