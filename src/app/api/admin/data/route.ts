import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedOrgId = searchParams.get('organization_id') || searchParams.get('org_id');
  const orgSlug = searchParams.get('slug') || searchParams.get('org');

  let orgFilter = requestedOrgId;
  if (!orgFilter && orgSlug) {
    const org = store.getOrganizationBySlug(orgSlug);
    if (org) orgFilter = org.id;
  }

  // Get data scoped to organization if specified
  const organizations = store.getOrganizations();
  const effectiveOrgId = orgFilter || GITAM_ORG_ID;

  const kiosks = store.getKiosks(orgFilter || undefined);
  const printers = store.getPrinters(orgFilter || undefined);
  const routings = store.getAllRoutings(orgFilter || undefined);
  const jobs = store.getAllJobs(orgFilter || undefined);
  const payments = store.getPayments(orgFilter || undefined);
  const branding = store.getBranding(effectiveOrgId);
  const pricing = store.getPricing(effectiveOrgId);
  const systemLogs = store.getSystemLogs(40, orgFilter || undefined);
  const auditLogs = store.getAuditLogs(40, orgFilter || undefined);
  const paymentConfig = store.getPaymentConfig(effectiveOrgId);
  const members = store.getMembers(orgFilter || undefined);
  const locations = store.getLocations(orgFilter || undefined);
  const devices = store.getDevices(orgFilter || undefined);

  // Calculate dashboard statistics (Accurate: Verified/Completed only!)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayJobs = jobs.filter(
    (j) => new Date(j.created_at).getTime() >= todayStart.getTime()
  );

  const completedJobs = jobs.filter((j) => j.status === 'COMPLETED');
  const todayCompletedJobs = todayJobs.filter((j) => j.status === 'COMPLETED');

  const todayRevenue = todayCompletedJobs.reduce(
    (acc, j) => acc + (j.calculated_amount || 0),
    0
  );

  const totalRevenue = completedJobs.reduce(
    (acc, j) => acc + (j.calculated_amount || 0),
    0
  );

  const failedJobs = jobs.filter((j) => j.status === 'FAILED');
  const recoveryRequired = jobs.filter((j) => j.status === 'RECOVERY_REQUIRED');

  // Mask payment secrets before returning
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
