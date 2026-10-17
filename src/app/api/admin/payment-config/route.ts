import { NextResponse } from 'next/server';
import { GITAM_ORG_ID } from '@/lib/store';
import { authenticateRequest } from '@/lib/auth';
import { dbGetPaymentConfig, dbUpsertPaymentConfig, dbWriteAuditLog } from '@/lib/db';
import { testRazorpayConnection } from '@/lib/razorpay';

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
        last_error: null,
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
      last_error: config.last_error,
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

    const {
      razorpay_key_id,
      razorpay_key_secret,
      webhook_secret,
      mode = 'TEST',
      test_connection,
    } = body;

    const existingConfig = await dbGetPaymentConfig(orgId);

    // Resolve key_id and secret to test/save
    const effectiveKeyId = razorpay_key_id ? razorpay_key_id.trim() : existingConfig?.razorpay_key_id || '';
    let effectiveKeySecret = '';
    if (razorpay_key_secret && !razorpay_key_secret.includes('••••')) {
      effectiveKeySecret = razorpay_key_secret.trim();
    } else {
      effectiveKeySecret = existingConfig?.razorpay_key_secret_encrypted || '';
    }

    let effectiveWebhookSecret = '';
    if (webhook_secret && !webhook_secret.includes('••••')) {
      effectiveWebhookSecret = webhook_secret.trim();
    } else {
      effectiveWebhookSecret = existingConfig?.webhook_secret_encrypted || '';
    }

    // ── CASE 1: Test Connection Request ─────────────────────────────────────────
    if (test_connection) {
      if (!effectiveKeyId || !effectiveKeySecret) {
        return NextResponse.json(
          {
            success: false,
            error: 'Cannot test connection: both Razorpay Key ID and Key Secret must be provided.',
            code: 'MISSING_CREDENTIALS',
          },
          { status: 400 }
        );
      }

      const diagnostic = await testRazorpayConnection({
        keyId: effectiveKeyId,
        keySecret: effectiveKeySecret,
        mode: mode as 'TEST' | 'LIVE',
        webhookSecret: effectiveWebhookSecret || undefined,
      });

      if (!diagnostic.success) {
        // Record verification failure in database for diagnostic transparency
        await dbUpsertPaymentConfig(orgId, {
          status: 'VERIFICATION_FAILED',
          last_error: diagnostic.message,
        });

        return NextResponse.json(
          {
            success: false,
            error: diagnostic.message,
            code: diagnostic.code,
            config: {
              organization_id: orgId,
              razorpay_key_id: effectiveKeyId,
              mode,
              status: 'VERIFICATION_FAILED',
              verified_at: null,
              last_error: diagnostic.message,
            },
          },
          { status: 400 }
        );
      }

      // Successful test: mark as CONFIGURED with new verified timestamp
      const now = new Date().toISOString();
      await dbUpsertPaymentConfig(orgId, {
        status: 'CONFIGURED',
        verified_at: now,
        last_error: null,
      });

      return NextResponse.json({
        success: true,
        message: diagnostic.message,
        config: {
          organization_id: orgId,
          razorpay_key_id: effectiveKeyId,
          mode,
          status: 'CONFIGURED',
          verified_at: now,
          last_error: null,
        },
      });
    }

    // ── CASE 2: Save Gateway Settings ──────────────────────────────────────────
    // Validate Webhook Secret format (common admin mistake: pasting webhook URL)
    if (effectiveWebhookSecret && (effectiveWebhookSecret.startsWith('http://') || effectiveWebhookSecret.startsWith('https://'))) {
      return NextResponse.json(
        {
          error:
            'Webhook Secret cannot be a URL. Enter the secret string you defined in Razorpay Dashboard when creating the webhook (or leave blank if unconfigured).',
        },
        { status: 400 }
      );
    }

    // Perform live connection diagnostic on save
    const diagnostic = await testRazorpayConnection({
      keyId: effectiveKeyId,
      keySecret: effectiveKeySecret,
      mode: mode as 'TEST' | 'LIVE',
      webhookSecret: effectiveWebhookSecret || undefined,
    });

    const isVerified = diagnostic.success;
    const verifiedAt = isVerified ? new Date().toISOString() : null;
    const status = isVerified ? 'CONFIGURED' : 'VERIFICATION_FAILED';
    const lastError = isVerified ? null : diagnostic.message;

    const updates: Parameters<typeof dbUpsertPaymentConfig>[1] = {
      razorpay_key_id: effectiveKeyId,
      mode: mode || 'TEST',
      status,
      verified_at: verifiedAt,
      last_error: lastError,
    };

    if (razorpay_key_secret && !razorpay_key_secret.includes('••••')) {
      updates.razorpay_key_secret = razorpay_key_secret.trim();
    }
    if (webhook_secret && !webhook_secret.includes('••••')) {
      updates.webhook_secret = webhook_secret.trim();
    }

    const saved = await dbUpsertPaymentConfig(orgId, updates);
    if (!saved) {
      return NextResponse.json(
        { error: 'Database write failed. Payment configuration was NOT saved.' },
        { status: 500 }
      );
    }

    // Audit log (never log secrets)
    await dbWriteAuditLog({
      admin_email: auth.user.email,
      action: 'UPDATE_PAYMENT_CONFIG',
      target_type: 'payment_configurations',
      target_id: orgId,
      details: {
        razorpay_key_id: effectiveKeyId,
        mode: mode || 'TEST',
        status,
        diagnostic_code: diagnostic.code,
        key_secret_updated: Boolean(updates.razorpay_key_secret),
        webhook_secret_updated: Boolean(updates.webhook_secret),
      },
      organization_id: orgId,
    });

    if (!isVerified) {
      return NextResponse.json(
        {
          success: false,
          error: `Gateway settings saved to database, but Razorpay connection failed: ${diagnostic.message}. Status is VERIFICATION_FAILED.`,
          code: diagnostic.code,
          config: {
            organization_id: saved.organization_id,
            razorpay_key_id: saved.razorpay_key_id,
            mode: saved.mode,
            status: saved.status,
            verified_at: saved.verified_at,
            last_error: saved.last_error,
          },
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Payment Gateway settings saved and verified with Razorpay API.',
      config: {
        organization_id: saved.organization_id,
        razorpay_key_id: saved.razorpay_key_id,
        mode: saved.mode,
        status: saved.status,
        verified_at: saved.verified_at,
        last_error: null,
      },
    });
  } catch (error) {
    console.error('[PAYMENT CONFIG POST ERROR]:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
