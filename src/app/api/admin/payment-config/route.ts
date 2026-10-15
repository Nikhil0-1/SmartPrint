import { NextResponse } from 'next/server';
import { GITAM_ORG_ID } from '@/lib/store';
import { authenticateRequest } from '@/lib/auth';
import { dbGetPaymentConfig, dbUpsertPaymentConfig, dbWriteAuditLog } from '@/lib/db';

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

  const config = await dbGetPaymentConfig(orgId);
  if (!config) {
    return NextResponse.json({
      success: true,
      config: {
        organization_id: orgId,
        razorpay_key_id: '',
        mode: 'TEST',
        status: 'NOT_CONFIGURED',
        has_key_secret: false,
        has_webhook_secret: false,
      },
    });
  }

  // NEVER return secrets to the browser
  return NextResponse.json({
    success: true,
    config: {
      id: config.id,
      organization_id: config.organization_id,
      razorpay_key_id: config.razorpay_key_id,
      mode: config.mode,
      status: config.status,
      verified_at: config.verified_at,
      has_key_secret: Boolean(config.razorpay_key_secret_encrypted),
      has_webhook_secret: Boolean(config.webhook_secret_encrypted),
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
      return NextResponse.json(
        { error: 'Access denied to manage payment config for this organization' },
        { status: 403 }
      );
    }

    const { razorpay_key_id, razorpay_key_secret, webhook_secret, mode } = body;

    // Validate key format
    let status = 'CONFIGURED';
    let verifiedAt: string | null = new Date().toISOString();

    if (!razorpay_key_id || !razorpay_key_secret) {
      status = 'NOT_CONFIGURED';
      verifiedAt = null;
    } else if (
      !razorpay_key_id.startsWith('rzp_test_') &&
      !razorpay_key_id.startsWith('rzp_live_')
    ) {
      status = 'VERIFICATION_FAILED';
      verifiedAt = null;
    }

    // Build the update payload — only include secrets if the user sent new ones
    const updates: Parameters<typeof dbUpsertPaymentConfig>[1] = {
      razorpay_key_id,
      mode: mode || 'TEST',
      status,
      verified_at: verifiedAt,
    };

    // Don't overwrite secrets with the masked placeholder value
    if (razorpay_key_secret && !razorpay_key_secret.includes('••••')) {
      updates.razorpay_key_secret = razorpay_key_secret;
    }
    if (webhook_secret && !webhook_secret.includes('••••')) {
      updates.webhook_secret = webhook_secret;
    }

    // Persist to Supabase — authoritative source of truth
    const saved = await dbUpsertPaymentConfig(orgId, updates);
    if (!saved) {
      return NextResponse.json(
        { error: 'Database write failed. Payment configuration was NOT saved.' },
        { status: 500 }
      );
    }

    // Audit log — never log the secrets themselves
    await dbWriteAuditLog({
      admin_email: auth.user.email,
      action: 'UPDATE_PAYMENT_CONFIG',
      target_type: 'payment_configurations',
      target_id: orgId,
      details: {
        razorpay_key_id,
        mode: mode || 'TEST',
        status,
        key_secret_updated: Boolean(updates.razorpay_key_secret),
        webhook_secret_updated: Boolean(updates.webhook_secret),
      },
      organization_id: orgId,
    });

    return NextResponse.json({
      success: true,
      config: {
        organization_id: saved.organization_id,
        razorpay_key_id: saved.razorpay_key_id,
        mode: saved.mode,
        status: saved.status,
        verified_at: saved.verified_at,
      },
    });
  } catch (error) {
    console.error('[PAYMENT CONFIG POST ERROR]:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
