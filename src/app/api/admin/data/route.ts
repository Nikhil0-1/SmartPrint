import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { GITAM_ORG_ID } from '@/lib/store';
import {
  dbGetOrganizations,
  dbGetOrganizationBySlug,
  dbGetKiosks,
  dbGetPrinters,
  dbGetBranding,
  dbGetPricing,
  dbGetPaymentConfig,
  dbGetMembersByOrg,
  dbGetLocations,
  dbGetAuditLogs,
  dbWriteAuditLog,
} from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase';
import { isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    // Require authentication on every call
    const authResult = await authenticateRequest(request);
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: authResult.error || 'Authentication required.' },
        { status: authResult.status }
      );
    }

    const callerUser = authResult.user;
    const { searchParams } = new URL(request.url);
    const requestedOrgId = searchParams.get('organization_id') || searchParams.get('org_id');
    const orgSlug = searchParams.get('slug') || searchParams.get('org');

    let resolvedOrgId: string | undefined = requestedOrgId || undefined;
    if (!resolvedOrgId && orgSlug) {
      const org = await dbGetOrganizationBySlug(orgSlug);
      if (org) resolvedOrgId = org.id;
    }

    // Enforce tenant isolation: org admins can only see their own org
    if (resolvedOrgId && !callerUser.isSuperAdmin) {
      if (!callerUser.authorizedOrganizationIds.includes(resolvedOrgId)) {
        await dbWriteAuditLog({
          admin_email: callerUser.email,
          action: 'CROSS_TENANT_ACCESS_BLOCKED',
          target_type: 'organization',
          target_id: resolvedOrgId,
          details: { caller_orgs: callerUser.authorizedOrganizationIds },
        });
        return NextResponse.json(
          { error: 'Access denied: You are not authorized to view this organization.' },
          { status: 403 }
        );
      }
    }

    // Determine effective org scope
    const effectiveOrgId: string | undefined = callerUser.isSuperAdmin
      ? resolvedOrgId || undefined
      : callerUser.authorizedOrganizationIds[0];

    // Fetch all data from Supabase (authoritative source)
    const allOrgs = await dbGetOrganizations();
    const organizations = callerUser.isSuperAdmin
      ? allOrgs
      : allOrgs.filter((o) => callerUser.authorizedOrganizationIds.includes(o.id));

    const kiosks = await dbGetKiosks(effectiveOrgId);
    const printers = await dbGetPrinters(effectiveOrgId);
    const branding = effectiveOrgId ? await dbGetBranding(effectiveOrgId) : null;
    const pricing = effectiveOrgId ? await dbGetPricing(effectiveOrgId) : null;
    const paymentConfig = effectiveOrgId ? await dbGetPaymentConfig(effectiveOrgId) : null;
    const members = effectiveOrgId ? await dbGetMembersByOrg(effectiveOrgId) : [];
    const locations = await dbGetLocations(effectiveOrgId);
    const auditLogs = callerUser.isSuperAdmin ? await dbGetAuditLogs(effectiveOrgId, 40) : [];

    // Fetch routing, devices, jobs, payments from Supabase if configured
    let routings: Record<string, unknown>[] = [];
    let devices: Record<string, unknown>[] = [];
    let jobs: Record<string, unknown>[] = [];
    let payments: Record<string, unknown>[] = [];
    let systemLogs: Record<string, unknown>[] = [];

    if (isSupabaseConfigured()) {
      // Printer routing
      {
        let q = supabaseAdmin.from('printer_routing').select('*');
        if (effectiveOrgId) {
          const kioskIds = kiosks.map((k) => k.id);
          if (kioskIds.length > 0) q = q.in('kiosk_id', kioskIds);
          else q = q.eq('kiosk_id', '__none__'); // return empty
        }
        const { data } = await q;
        routings = data || [];
      }

      // Devices
      {
        let q = supabaseAdmin.from('devices').select('*');
        if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId);
        const { data } = await q;
        devices = data || [];
      }

      // Print Jobs (recent 200)
      {
        let q = supabaseAdmin
          .from('print_jobs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200);
        if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId);
        const { data } = await q;
        jobs = data || [];
      }

      // Payments (recent 200)
      {
        let q = supabaseAdmin
          .from('payments')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200);
        const { data } = await q;
        payments = data || [];
      }

      // System Logs (recent 40)
      {
        let q = supabaseAdmin
          .from('system_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(40);
        const { data } = await q;
        systemLogs = data || [];
      }
    }

    // Dashboard statistics (based on actual DB data)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayJobs = jobs.filter(
      (j) => new Date(j.created_at as string).getTime() >= todayStart.getTime()
    );
    const completedJobs = jobs.filter((j) => j.status === 'COMPLETED');
    const todayCompletedJobs = todayJobs.filter((j) => j.status === 'COMPLETED');
    const todayRevenue = todayCompletedJobs.reduce(
      (acc, j) => acc + ((j.calculated_amount as number) || 0),
      0
    );
    const totalRevenue = completedJobs.reduce(
      (acc, j) => acc + ((j.calculated_amount as number) || 0),
      0
    );
    const failedJobs = jobs.filter((j) => j.status === 'FAILED');
    const recoveryRequired = jobs.filter((j) => j.status === 'RECOVERY_REQUIRED');

    // Mask payment secrets before returning to client
    const safePaymentConfig = paymentConfig
      ? {
          id: paymentConfig.id,
          organization_id: paymentConfig.organization_id,
          razorpay_key_id: paymentConfig.razorpay_key_id,
          mode: paymentConfig.mode,
          status: paymentConfig.status,
          verified_at: paymentConfig.verified_at,
          has_key_secret: Boolean(paymentConfig.razorpay_key_secret_encrypted),
          has_webhook_secret: Boolean(paymentConfig.webhook_secret_encrypted),
        }
      : null;

    return NextResponse.json({
      stats: {
        total_prints: completedJobs.length,
        today_prints: todayCompletedJobs.length,
        today_revenue: todayRevenue,
        total_revenue: totalRevenue,
        active_kiosks: kiosks.length,
        online_kiosks: kiosks.filter((k) => k.status === 'ONLINE').length,
        online_printers: printers.filter((p) => p.status === 'READY' && p.enabled).length,
        failed_jobs: failedJobs.length,
        recovery_required: recoveryRequired.length,
        organizations_count: organizations.length,
      },
      organizations,
      current_organization_id: effectiveOrgId,
      kiosks,
      printers,
      routings,
      jobs,
      payments,
      branding,
      pricing,
      payment_config: safePaymentConfig,
      members,
      locations,
      devices,
      system_logs: systemLogs,
      audit_logs: auditLogs,
    });
  } catch (error) {
    console.error('[ADMIN DATA GET ERROR]:', error);
    return NextResponse.json(
      {
        error: (error as Error).message || 'Failed to fetch admin data.',
        stats: {
          total_prints: 0,
          today_prints: 0,
          today_revenue: 0,
          total_revenue: 0,
          active_kiosks: 0,
          online_kiosks: 0,
          online_printers: 0,
          failed_jobs: 0,
          recovery_required: 0,
          organizations_count: 1,
        },
        organizations: [],
        kiosks: [],
        printers: [],
        routings: [],
        jobs: [],
        payments: [],
        branding: null,
        pricing: null,
        payment_config: null,
        members: [],
        locations: [],
        devices: [],
        system_logs: [],
        audit_logs: [],
      },
      { status: 500 }
    );
  }
}
