import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function GET() {
  const kiosks = store.getKiosks();
  const printers = store.getPrinters();
  const jobs = store.getAllJobs();
  const payments = store.getPayments();
  const branding = store.getBranding();
  const pricing = store.getPricing();
  const systemLogs = store.getSystemLogs(40);
  const auditLogs = store.getAuditLogs(40);

  // Calculate dashboard statistics
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

  const routings = store.getAllRoutings();

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
    },
    kiosks,
    printers,
    routings,
    jobs,
    payments,
    branding,
    pricing,
    system_logs: systemLogs,
    audit_logs: auditLogs,
  });
}
