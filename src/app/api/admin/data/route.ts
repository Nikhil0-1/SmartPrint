import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { authenticateRequest } from '@/lib/auth';

export async function GET(request: Request) {
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
    const org = store.getOrganizationBySlug(orgSlug);
    if (org) resolvedOrgId = org.id;
  }

  // Enforce tenant isolation: org admins can only see their own org
  if (resolvedOrgId && !callerUser.isSuperAdmin) {
    if (!callerUser.authorizedOrganizationIds.includes(resolvedOrgId)) {
      store.logAudit(callerUser.email, 'CROSS_TENANT_ACCESS_BLOCKED', 'organization', resolvedOrgId, {
        caller_orgs: callerUser.authorizedOrganizationIds,
      });
      return NextResponse.json({ error: 'Access denied: You are not authorized to view this organization.' }, { status: 403 });
    }
  }

  // Determine effective org scope
  const effectiveOrgId: string | undefined = callerUser.isSuperAdmin
    ? (resolvedOrgId || undefined)
    : callerUser.authorizedOrganizationIds[0];

  const organizations = callerUser.isSuperAdmin
    ? store.getOrganizations()
    : store.getOrganizations().filter((o) => callerUser.authorizedOrganizationIds.includes(o.id));

  const kiosks = store.getKiosks(effectiveOrgId);
  const printers = store.getPrinters(effectiveOrgId);
  const routings = store.getAllRoutings(effectiveOrgId);
  const jobs = store.getAllJobs(effectiveOrgId);
  const payments = store.getPayments(effectiveOrgId);
  const branding = effectiveOrgId ? store.getBranding(effectiveOrgId) : null;
  const pricing = effectiveOrgId ? store.getPricing(effectiveOrgId) : null;
  const systemLogs = store.getSystemLogs(40, effectiveOrgId);
  const auditLogs = callerUser.isSuperAdmin ? store.getAuditLogs(40, effectiveOrgId) : [];
  const paymentConfig = effectiveOrgId ? store.getPaymentConfig(effectiveOrgId) : null;
  const members = store.getMembers(effectiveOrgId);
  const locations = store.getLocations(effectiveOrgId);
  const devices = store.getDevices(effectiveOrgId);

  // Dashboard statistics (verified/completed only)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayJobs = jobs.filter((j) => new Date(j.created_at).getTime() >= todayStart.getTime());
  const completedJobs = jobs.filter((j) => j.status === 'COMPLETED');
  const todayCompletedJobs = todayJobs.filter((j) => j.status === 'COMPLETED');
  const todayRevenue = todayCompletedJobs.reduce((acc, j) => acc + (j.calculated_amount || 0), 0);
  const totalRevenue = completedJobs.reduce((acc, j) => acc + (j.calculated_amount || 0), 0);
  const failedJobs = jobs.filter((j) => j.status === 'FAILED');
  const recoveryRequired = jobs.filter((j) => j.status === 'RECOVERY_REQUIRED');

  // Mask payment secrets before returning to client
  const safePaymentConfig = paymentConfig
    ? {
        ...paymentConfig,
        razorpay_key_secret: paymentConfig.razorpay_key_secret ? '••••••••••••••••' : '',
        webhook_secret: paymentConfig.webhook_secret ? '••••••••••••••••' : '',
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
}

