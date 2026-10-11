import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { authenticateRequest } from '@/lib/auth';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('organization_id') || auth.user.authorizedOrganizationIds[0] || GITAM_ORG_ID;

  if (!auth.user.isSuperAdmin && !auth.user.authorizedOrganizationIds.includes(orgId)) {
    return NextResponse.json({ error: 'Access denied to this organization' }, { status: 403 });
  }

  const config = store.getPaymentConfig(orgId);
  if (!config) {
    return NextResponse.json({
      success: true,
      config: {
        organization_id: orgId,
        razorpay_key_id: '',
        mode: 'TEST',
        status: 'NOT_CONFIGURED',
      },
    });
  }

  return NextResponse.json({
    success: true,
    config: {
      id: config.id,
      organization_id: config.organization_id,
      razorpay_key_id: config.razorpay_key_id,
      mode: config.mode,
      status: config.status,
      verified_at: config.verified_at,
      has_key_secret: Boolean(config.razorpay_key_secret),
      has_webhook_secret: Boolean(config.webhook_secret),
    },
  });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const orgId = body.organization_id || auth.user.authorizedOrganizationIds[0] || GITAM_ORG_ID;

    if (!auth.user.isSuperAdmin && !auth.user.authorizedOrganizationIds.includes(orgId)) {
      return NextResponse.json({ error: 'Access denied to manage payment config for this organization' }, { status: 403 });
    }

    const { razorpay_key_id, razorpay_key_secret, webhook_secret, mode, test_connection } = body;

    let status = 'CONFIGURED';
    let verifiedAt = new Date().toISOString();

    // Verification check: ensure credentials format is valid
    if (!razorpay_key_id || !razorpay_key_secret) {
      status = 'NOT_CONFIGURED';
      verifiedAt = undefined as any;
    } else if (
      !razorpay_key_id.startsWith('rzp_test_') &&
      !razorpay_key_id.startsWith('rzp_live_')
    ) {
      status = 'VERIFICATION_FAILED';
    }

    const updated = store.updatePaymentConfig(
      orgId,
      {
        razorpay_key_id,
        ...(razorpay_key_secret && razorpay_key_secret !== '••••••••••••••••' ? { razorpay_key_secret } : {}),
        ...(webhook_secret && webhook_secret !== '••••••••••••••••' ? { webhook_secret } : {}),
        mode: mode || 'TEST',
        status: status as any,
        verified_at: verifiedAt,
      },
      auth.user.email
    );

    return NextResponse.json({
      success: true,
      config: {
        organization_id: updated.organization_id,
        razorpay_key_id: updated.razorpay_key_id,
        mode: updated.mode,
        status: updated.status,
        verified_at: updated.verified_at,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
