'use client';

import React, { use } from 'react';
import CustomerPrintPage from '../page';

export default function OrgSpecificPrintPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const resolved = use(params);
  return <CustomerPrintPage orgSlug={resolved.orgSlug} />;
}
