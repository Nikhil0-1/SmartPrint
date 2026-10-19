import { NextResponse } from 'next/server';
import { store, GITAM_ORG_ID } from '@/lib/store';
import { KioskMonitorState, PrintJob } from '@/lib/types';

export function maskJobId(id: string): string {
  if (!id) return 'SP-****';
  const parts = id.split('-');
  if (parts.length >= 3) {
    return `${parts[0]}-****-${parts[parts.length - 1]}`;
  }
  return id.length > 6 ? `${id.slice(0, 3)}****${id.slice(-3)}` : 'SP-****';
}

export function deriveMonitorState(
  isMaintenance: boolean,
  printerStatus: string,
  activeJob: PrintJob | null
): { state: KioskMonitorState; subMessage?: string } {
  if (isMaintenance) {
    return { state: 'MAINTENANCE', subMessage: 'Kiosk is currently undergoing maintenance' };
  }

  if (!activeJob) {
    if (printerStatus === 'ERROR' || printerStatus === 'OFFLINE') {
      return { state: 'ERROR', subMessage: 'Printer unavailable or offline' };
    }
    return { state: 'IDLE' };
  }

  // Active Job State Machine
  switch (activeJob.status) {
    case 'CREATED':
    case 'UPLOAD_COMPLETE':
    case 'VALIDATING':
      return {
        state: 'DOCUMENT_RECEIVED',
        subMessage: 'Document received successfully. Validating pages...',
      };

    case 'PAYMENT_PENDING':
      return {
        state: 'PROCESSING',
        subMessage: 'Awaiting payment on customer mobile...',
      };

    case 'PAYMENT_VERIFIED':
    case 'QUEUED':
      return {
        state: 'PROCESSING',
        subMessage: 'Payment verified. Preparing print job...',
      };

    case 'DEVICE_ACCEPTED':
    case 'DOWNLOADING':
      return {
        state: 'PROCESSING',
        subMessage: 'Sending to printer controller...',
      };

    case 'PROCESSING':
    case 'SUBMITTED_TO_CUPS':
      return {
        state: 'PROCESSING',
        subMessage: 'Processing raster print job in CUPS...',
      };

    case 'PRINTING':
      return {
        state: 'PRINTING',
        subMessage: 'Printing document. Please collect from output tray.',
      };

    case 'PRINT_COMPLETION_REPORTED':
    case 'CLEANUP_PENDING':
    case 'COMPLETED':
      return {
        state: 'COMPLETED',
        subMessage: 'Print completed successfully. Temporary file shredded.',
      };

    case 'FAILED':
    case 'RECOVERY_REQUIRED':
    case 'PRINTER_UNAVAILABLE':
    case 'DRIVER_UNAVAILABLE':
    case 'DEVICE_OFFLINE':
      return {
        state: 'RECOVERY_REQUIRED',
        subMessage: activeJob.error_message || 'Print processing error. Support alerted.',
      };

    case 'EXPIRED':
    case 'CANCELLED':
      return {
        state: 'IDLE',
      };

    default:
      return { state: 'IDLE' };
  }
}

export async function handleGetKioskStatus(kioskId: string) {
  if (!kioskId) {
    return NextResponse.json({ error: 'Kiosk ID is required' }, { status: 400 });
  }

  const kiosk = store.getKiosk(kioskId);
  if (!kiosk) {
    return NextResponse.json({ error: 'Kiosk not found' }, { status: 404 });
  }

  const orgId = kiosk.organization_id || GITAM_ORG_ID;
  const org = store.getOrganization(orgId);
  const branding = store.getBranding(orgId);
  const pricing = store.getPricing(orgId);

  // Get default printer for this kiosk
  const printers = store.getPrinters(orgId, kioskId);
  const defaultPrinter = printers.find((p) => p.is_default) || printers[0];
  const printerStatus = defaultPrinter?.status || 'READY';

  // Get Authoritative Active Job
  const activeJob = store.getActiveJobForKiosk(kioskId);

  // Derive strict monitor state
  const { state: monitorState, subMessage } = deriveMonitorState(
    kiosk.maintenance_mode || kiosk.status === 'MAINTENANCE',
    printerStatus,
    activeJob
  );

  // Prepare privacy-safe active job summary (Never expose private filenames, customer tokens, or full URLs)
  const safeJobSummary = activeJob
    ? {
        masked_id: maskJobId(activeJob.id),
        status: activeJob.status,
        pages_total: activeJob.pages_total,
        copies: activeJob.copies,
        is_color: activeJob.is_color,
        is_duplex: activeJob.is_duplex,
        paper_size: activeJob.paper_size,
        created_at: activeJob.created_at,
        completed_at: activeJob.completed_at,
        error_message: monitorState === 'RECOVERY_REQUIRED' ? activeJob.error_message : undefined,
      }
    : null;

  // Permanent public QR URL that customers scan to initiate their own isolated session
  const permanentQrUrl = `/print?kiosk_id=${kiosk.id}`;

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    kiosk: {
      id: kiosk.id,
      name: kiosk.name,
      location: kiosk.location,
      status: kiosk.status,
      maintenance_mode: kiosk.maintenance_mode,
      permanent_qr_url: permanentQrUrl,
      active_job_id: safeJobSummary ? safeJobSummary.masked_id : null,
    },
    monitor_state: monitorState,
    sub_message: subMessage,
    active_job: safeJobSummary,
    branding: {
      organization: org?.name || branding.organization,
      product: branding.product || 'SMARTPRINT',
      logo_url: org?.logo_url || branding.logo_url,
      primary_tagline: branding.primary_tagline || 'Autonomous Student Printing',
      secondary_tagline: branding.secondary_tagline || 'Scan. Upload. Pay. Print.',
      support_number: branding.support_number || '9006496970',
      powered_by: branding.powered_by || 'Nikhil',
      brand_colors: org?.brand_colors || {
        primary: '#0d253f',
        secondary: '#1e40af',
        accent: '#ef4444',
        bg: '#ffffff',
      },
    },
    pricing: {
      bw_price_per_page: pricing.bw_price_per_page || 1.0,
      color_price_per_page: pricing.color_price_per_page || 5.0,
      currency: pricing.currency || 'INR',
    },
    printer: {
      status: printerStatus,
      display_name: defaultPrinter?.display_name || 'HP LaserJet USB',
      model: defaultPrinter?.model || 'LaserJet Pro',
      supports_color: defaultPrinter?.supports_color ?? false,
    },
  });
}

export async function handlePostKioskStatus(kioskId: string, body: Record<string, unknown>) {
  const action = body.action;

  if (action === 'reset_idle') {
    const activeJob = store.getActiveJobForKiosk(kioskId);
    if (
      body.force ||
      !activeJob ||
      activeJob.status === 'COMPLETED' ||
      activeJob.status === 'EXPIRED' ||
      activeJob.status === 'FAILED'
    ) {
      store.releaseKioskJob(kioskId);
      return NextResponse.json({ success: true, message: 'Kiosk reset to IDLE' });
    } else {
      return NextResponse.json(
        { error: 'Cannot reset to IDLE while an active unresolved print job is in progress' },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
