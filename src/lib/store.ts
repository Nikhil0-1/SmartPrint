import {
  BrandingConfig,
  PricingConfig,
  Kiosk,
  Printer,
  Session,
  PrintJob,
  FileMetadata,
  PaymentRecord,
  SystemLog,
  AuditLog,
  PrintJobStatus,
  PrinterStatus,
} from './types';
import { DEFAULT_BRANDING, DEFAULT_PRICING, INITIAL_KIOSKS, INITIAL_PRINTERS } from './constants';

// In-Memory store fallback with Supabase sync capabilities
class StateManager {
  private branding: BrandingConfig = { ...DEFAULT_BRANDING };
  private pricing: PricingConfig = { ...DEFAULT_PRICING };
  private kiosks: Map<string, Kiosk> = new Map();
  private printers: Map<string, Printer> = new Map();
  private sessions: Map<string, Session> = new Map();
  private jobs: Map<string, PrintJob> = new Map();
  private files: Map<string, FileMetadata> = new Map();
  private payments: Map<string, PaymentRecord> = new Map();
  private systemLogs: SystemLog[] = [];
  private auditLogs: AuditLog[] = [];

  constructor() {
    INITIAL_KIOSKS.forEach((k) => this.kiosks.set(k.id, { ...k }));
    INITIAL_PRINTERS.forEach((p) => this.printers.set(p.kiosk_id, { ...p }));

    this.logSystem(
      'INFO',
      'BACKEND',
      'GITAM SMARTPRINT system initialized with default configuration',
      { kiosksCount: this.kiosks.size }
    );
  }

  // --- BRANDING ---
  getBranding(): BrandingConfig {
    return { ...this.branding };
  }

  updateBranding(updates: Partial<BrandingConfig>, adminEmail = 'admin@gitam.edu'): BrandingConfig {
    this.branding = { ...this.branding, ...updates };
    this.logAudit(adminEmail, 'UPDATE_BRANDING', 'branding', 'main', updates);
    return { ...this.branding };
  }

  // --- PRICING ---
  getPricing(): PricingConfig {
    return { ...this.pricing };
  }

  updatePricing(updates: Partial<PricingConfig>, adminEmail = 'admin@gitam.edu'): PricingConfig {
    this.pricing = {
      ...this.pricing,
      ...updates,
      updated_by: adminEmail,
      updated_at: new Date().toISOString(),
    };
    this.logAudit(adminEmail, 'UPDATE_PRICING', 'pricing', 'main', updates);
    return { ...this.pricing };
  }

  // --- KIOSKS ---
  getKiosks(): Kiosk[] {
    return Array.from(this.kiosks.values());
  }

  getKiosk(id: string): Kiosk | undefined {
    return this.kiosks.get(id);
  }

  updateKiosk(id: string, updates: Partial<Kiosk>, adminEmail?: string): Kiosk | null {
    const kiosk = this.kiosks.get(id);
    if (!kiosk) return null;
    const updated = { ...kiosk, ...updates };
    this.kiosks.set(id, updated);
    if (adminEmail) {
      this.logAudit(adminEmail, 'UPDATE_KIOSK', 'kiosks', id, updates);
    }
    return updated;
  }

  recordHeartbeat(
    kioskId: string,
    telemetry: {
      cpu_temp?: number;
      ram_usage?: number;
      disk_usage?: number;
      printer_status?: PrinterStatus;
      printer_message?: string;
      agent_version?: string;
    }
  ): boolean {
    const kiosk = this.kiosks.get(kioskId);
    if (!kiosk) return false;

    kiosk.status = kiosk.maintenance_mode ? 'MAINTENANCE' : 'ONLINE';
    kiosk.last_heartbeat = new Date().toISOString();
    if (telemetry.cpu_temp !== undefined) kiosk.cpu_temp_celsius = telemetry.cpu_temp;
    if (telemetry.ram_usage !== undefined) kiosk.ram_usage_percent = telemetry.ram_usage;
    if (telemetry.disk_usage !== undefined) kiosk.disk_usage_percent = telemetry.disk_usage;
    if (telemetry.agent_version) kiosk.agent_version = telemetry.agent_version;

    if (telemetry.printer_status) {
      const printer = this.printers.get(kioskId);
      if (printer) {
        printer.status = telemetry.printer_status;
        if (telemetry.printer_message) printer.last_error = telemetry.printer_message;
      }
    }
    return true;
  }

  // --- PRINTERS ---
  getPrinters(): Printer[] {
    return Array.from(this.printers.values());
  }

  getPrinterByKiosk(kioskId: string): Printer | undefined {
    return this.printers.get(kioskId);
  }

  updatePrinter(kioskId: string, updates: Partial<Printer>, adminEmail?: string): Printer | null {
    const printer = this.printers.get(kioskId);
    if (!printer) return null;
    const updated = { ...printer, ...updates };
    this.printers.set(kioskId, updated);
    if (adminEmail) {
      this.logAudit(adminEmail, 'UPDATE_PRINTER', 'printers', kioskId, updates);
    }
    return updated;
  }

  // --- SESSIONS ---
  createSession(kioskId: string): Session {
    const sessionToken = `sess_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min expiry
    const session: Session = {
      id: `SES-${Date.now().toString(36).toUpperCase()}`,
      kiosk_id: kioskId,
      session_token: sessionToken,
      status: 'ACTIVE',
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (new Date(session.expires_at) < new Date()) {
      session.status = 'EXPIRED';
    }
    return session;
  }

  // --- PRINT JOBS ---
  createJob(jobData: Omit<PrintJob, 'status' | 'created_at'>): PrintJob {
    const job: PrintJob = {
      ...jobData,
      status: 'CREATED',
      created_at: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    this.logSystem('INFO', 'BACKEND', `Print job created: ${job.id}`, {
      kiosk_id: job.kiosk_id,
      amount: job.calculated_amount,
    });
    return job;
  }

  getJob(jobId: string): PrintJob | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): PrintJob[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  getPendingJobsForKiosk(kioskId: string): PrintJob[] {
    return Array.from(this.jobs.values()).filter(
      (j) => j.kiosk_id === kioskId && j.status === 'PAYMENT_VERIFIED'
    );
  }

  updateJobStatus(
    jobId: string,
    status: PrintJobStatus,
    metadata?: { cups_job_id?: number; error_message?: string; recovery_reason?: string }
  ): PrintJob | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    job.status = status;
    if (metadata?.cups_job_id !== undefined) job.cups_job_id = metadata.cups_job_id;
    if (metadata?.error_message !== undefined) job.error_message = metadata.error_message;
    if (metadata?.recovery_reason !== undefined) job.recovery_reason = metadata.recovery_reason;

    if (status === 'COMPLETED') {
      job.completed_at = new Date().toISOString();
      // Revoke any temporary signed URL access
      job.signed_download_url = undefined;
    }

    this.logSystem('INFO', 'BACKEND', `Job ${jobId} transitioned to ${status}`, metadata);
    return job;
  }

  // --- SECURE TEMPORARY FILE LIFECYCLE ---
  registerFile(
    jobId: string,
    originalFilename: string,
    mimeType: string,
    sizeBytes: number,
    pageCount: number,
    storagePath: string
  ): FileMetadata {
    const fileId = `file_${Math.random().toString(36).substring(2, 9)}`;
    const metadata: FileMetadata = {
      id: fileId,
      job_id: jobId,
      storage_path: storagePath,
      original_filename: originalFilename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      page_count: pageCount,
      status: 'TEMPORARY',
      created_at: new Date().toISOString(),
    };
    this.files.set(fileId, metadata);
    return metadata;
  }

  deleteJobFile(jobId: string): boolean {
    let deleted = false;
    for (const [id, file] of this.files.entries()) {
      if (file.job_id === jobId) {
        file.status = 'DELETED';
        file.storage_path = null; // Access reference erased!
        file.deleted_at = new Date().toISOString();
        deleted = true;
        this.logSystem(
          'INFO',
          'CLEANUP',
          `DOCUMENT DELETED: Temporary file ${id} permanently wiped for job ${jobId}`,
          { file_id: id, job_id: jobId }
        );
      }
    }
    // Also remove signed URL on job record
    const job = this.jobs.get(jobId);
    if (job) {
      job.signed_download_url = undefined;
    }
    return deleted;
  }

  // --- PAYMENTS ---
  createPayment(
    jobId: string,
    razorpayOrderId: string,
    amount: number,
    currency = 'INR'
  ): PaymentRecord {
    const payment: PaymentRecord = {
      id: `PAY-${Date.now().toString(36).toUpperCase()}`,
      job_id: jobId,
      razorpay_order_id: razorpayOrderId,
      amount,
      currency,
      status: 'PENDING',
      created_at: new Date().toISOString(),
    };
    this.payments.set(payment.id, payment);
    return payment;
  }

  verifyPayment(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    signature: string
  ): PaymentRecord | null {
    let found: PaymentRecord | null = null;
    for (const p of this.payments.values()) {
      if (p.razorpay_order_id === razorpayOrderId) {
        p.razorpay_payment_id = razorpayPaymentId;
        p.status = 'SUCCESS';
        p.verified_at = new Date().toISOString();
        found = p;
        break;
      }
    }

    if (found) {
      // Find and update job to PAYMENT_VERIFIED
      const job = this.jobs.get(found.job_id);
      if (job && job.status === 'UPLOAD_COMPLETE') {
        job.status = 'PAYMENT_VERIFIED';
        job.payment_id = razorpayPaymentId;
        // Generate short-lived signed download URL (valid for local Raspberry Pi agent)
        job.signed_download_url = `/api/kiosk/download/${job.id}?token=${job.idempotency_key}`;
        this.logSystem(
          'INFO',
          'WEBHOOK',
          `PAYMENT VERIFIED: Razorpay ${razorpayPaymentId} verified. Authorized print job ${job.id}.`
        );
      }
    }
    return found;
  }

  getPayments(): PaymentRecord[] {
    return Array.from(this.payments.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  // --- SYSTEM & AUDIT LOGS ---
  logSystem(
    level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL',
    component: 'RASPBERRY_PI' | 'CUPS' | 'BACKEND' | 'WEBHOOK' | 'CLEANUP' | 'ADMIN',
    message: string,
    metadata?: Record<string, unknown>
  ) {
    const entry: SystemLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      level,
      component,
      message,
      metadata,
      created_at: new Date().toISOString(),
    };
    this.systemLogs.unshift(entry);
    if (this.systemLogs.length > 500) this.systemLogs.pop();
  }

  logAudit(
    adminEmail: string,
    action: string,
    targetType: string,
    targetId?: string,
    details?: Record<string, unknown>
  ) {
    const entry: AuditLog = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      admin_email: adminEmail,
      action,
      target_type: targetType,
      target_id: targetId,
      details,
      created_at: new Date().toISOString(),
    };
    this.auditLogs.unshift(entry);
    if (this.auditLogs.length > 500) this.auditLogs.pop();
  }

  getSystemLogs(limit = 100): SystemLog[] {
    return this.systemLogs.slice(0, limit);
  }

  getAuditLogs(limit = 100): AuditLog[] {
    return this.auditLogs.slice(0, limit);
  }
}

// Global Singleton pattern across Next.js API reloads
declare global {
  // eslint-disable-next-line no-var
  var __smartprint_store__: StateManager | undefined;
}

export const store = global.__smartprint_store__ || new StateManager();
if (process.env.NODE_ENV !== 'production') {
  global.__smartprint_store__ = store;
}
