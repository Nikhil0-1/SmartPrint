import {
  Organization,
  OrganizationMember,
  Location,
  Device,
  BrandingConfig,
  PricingConfig,
  Kiosk,
  Printer,
  PrinterRouting,
  Session,
  PrintJob,
  FileMetadata,
  PaymentConfiguration,
  PaymentOrder,
  PaymentRecord,
  WebhookEventRecord,
  CleanupJob,
  DeviceCommand,
  SystemLog,
  AuditLog,
  PrintJobStatus,
  PrinterStatus,
} from './types';
import {
  DEFAULT_BRANDING,
  DEFAULT_PRICING,
  INITIAL_KIOSKS,
  INITIAL_PRINTERS,
  INITIAL_PRINTER_ROUTING,
} from './constants';

export const GITAM_ORG_ID = '00000000-0000-0000-0000-000000000001';
export const APNA_ORG_ID = '00000000-0000-0000-0000-000000000002';

class StateManager {
  private organizations: Map<string, Organization> = new Map();
  private members: Map<string, OrganizationMember> = new Map();
  private locations: Map<string, Location> = new Map();
  private devices: Map<string, Device> = new Map();
  private kiosks: Map<string, Kiosk> = new Map();
  private printers: Map<string, Printer> = new Map();
  private routings: Map<string, PrinterRouting> = new Map();
  private brandingConfigs: Map<string, BrandingConfig> = new Map();
  private pricingConfigs: Map<string, PricingConfig> = new Map();
  private paymentConfigs: Map<string, PaymentConfiguration> = new Map();
  private paymentOrders: Map<string, PaymentOrder> = new Map();
  private payments: Map<string, PaymentRecord> = new Map();
  private webhookEvents: Map<string, WebhookEventRecord> = new Map();
  private sessions: Map<string, Session> = new Map();
  private jobs: Map<string, PrintJob> = new Map();
  private files: Map<string, FileMetadata> = new Map();
  private cleanupJobs: Map<string, CleanupJob> = new Map();
  private deviceCommands: Map<string, DeviceCommand> = new Map();
  private systemLogs: SystemLog[] = [];
  private auditLogs: AuditLog[] = [];

  constructor() {
    this.seedInitialState();
  }

  private seedInitialState() {
    // 1. Seed Organizations
    const gitamOrg: Organization = {
      id: GITAM_ORG_ID,
      name: 'GITAM SMARTPRINT',
      slug: 'gitam',
      brand_colors: {
        primary: '#0d253f',
        secondary: '#1e40af',
        accent: '#ef4444',
        bg: '#ffffff',
      },
      public_url: 'https://smartprint.gitam.edu',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const apnaOrg: Organization = {
      id: APNA_ORG_ID,
      name: 'APNA SMART PRINTER',
      slug: 'apna',
      brand_colors: {
        primary: '#111827',
        secondary: '#059669',
        accent: '#d97706',
        bg: '#f9fafb',
      },
      public_url: 'https://apnaprint.in',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.organizations.set(gitamOrg.id, gitamOrg);
    this.organizations.set(apnaOrg.id, apnaOrg);

    // 2. Seed Admin Members
    this.members.set('admin@gitam.edu', {
      id: 'mem-001',
      organization_id: GITAM_ORG_ID,
      firebase_uid: 'firebase_admin_super_001',
      email: 'admin@gitam.edu',
      full_name: 'GITAM Super Administrator',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
    });

    this.members.set('superadmin@gmail.com', {
      id: 'mem-000',
      organization_id: GITAM_ORG_ID,
      firebase_uid: 'firebase_admin_super_000',
      email: 'superadmin@gmail.com',
      full_name: 'Platform Super Administrator',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
    });

    this.members.set('admin@apnaprint.in', {
      id: 'mem-002',
      organization_id: APNA_ORG_ID,
      firebase_uid: 'firebase_admin_apna_001',
      email: 'admin@apnaprint.in',
      full_name: 'Apna Print Org Administrator',
      role: 'ORG_ADMIN',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
    });

    // 3. Seed Locations
    this.locations.set('loc-gitam-01', {
      id: 'loc-gitam-01',
      organization_id: GITAM_ORG_ID,
      name: 'Central Knowledge Resource Centre (Library)',
      address: 'GITAM Deemed University, Rushikonda, Visakhapatnam',
      description: 'Ground Floor student kiosk pavilion',
      created_at: new Date().toISOString(),
    });

    // 4. Seed Kiosks with Organization binding
    INITIAL_KIOSKS.forEach((k) => {
      this.kiosks.set(k.id, {
        ...k,
        organization_id: GITAM_ORG_ID,
        location_id: 'loc-gitam-01',
        kiosk_slug: k.id.toLowerCase(),
        permanent_qr_url: `/print/gitam/${k.id.toLowerCase()}`,
      });
    });

    // 5. Seed Devices
    this.devices.set('RPI-GITAM-SPK-001', {
      id: 'RPI-GITAM-SPK-001',
      organization_id: GITAM_ORG_ID,
      kiosk_id: 'GITAM-SPK-001',
      device_token_hash: 'gitam_spk_001_secure_device_secret_2026',
      status: 'ONLINE',
      ip_address: '192.168.1.105',
      mac_address: 'B8:27:EB:4D:2A:11',
      agent_version: '1.0.0',
      last_heartbeat: new Date().toISOString(),
      cpu_temp_celsius: 42.5,
      ram_usage_percent: 34.2,
      disk_usage_percent: 18.7,
    });

    // 6. Seed Printers
    INITIAL_PRINTERS.forEach((p) => {
      this.printers.set(p.id, {
        ...p,
        organization_id: GITAM_ORG_ID,
      });
    });

    // 7. Seed Printer Routings
    INITIAL_PRINTER_ROUTING.forEach((r) => {
      this.routings.set(r.kiosk_id, {
        ...r,
        organization_id: GITAM_ORG_ID,
      });
    });

    // 8. Seed Branding & Pricing per Organization
    this.brandingConfigs.set(GITAM_ORG_ID, {
      ...DEFAULT_BRANDING,
      organization_id: GITAM_ORG_ID,
    });

    this.pricingConfigs.set(GITAM_ORG_ID, {
      ...DEFAULT_PRICING,
      organization_id: GITAM_ORG_ID,
      bw_price_paise: 100, // ₹1
      color_price_paise: 500, // ₹5
    });

    this.brandingConfigs.set(APNA_ORG_ID, {
      ...DEFAULT_BRANDING,
      organization_id: APNA_ORG_ID,
      organization: 'APNA SMART PRINTER',
      product: 'PRINTER',
      primary_tagline: 'FAST & SECURE LOCAL PRINTING',
      support_number: '9876543210',
    });

    this.pricingConfigs.set(APNA_ORG_ID, {
      ...DEFAULT_PRICING,
      organization_id: APNA_ORG_ID,
      bw_price_per_page: 2.0,
      color_price_per_page: 8.0,
      bw_price_paise: 200,
      color_price_paise: 800,
    });

    // 9. Seed Payment Configurations
    this.paymentConfigs.set(GITAM_ORG_ID, {
      id: 'pay-cfg-001',
      organization_id: GITAM_ORG_ID,
      razorpay_key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_gitam_smartprint',
      razorpay_key_secret: process.env.RAZORPAY_KEY_SECRET || 'secret_gitam_smartprint_2026',
      webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET || 'webhook_secret_gitam_smartprint',
      mode: 'TEST',
      status: 'CONFIGURED',
      verified_at: new Date().toISOString(),
    });

    this.paymentConfigs.set(APNA_ORG_ID, {
      id: 'pay-cfg-002',
      organization_id: APNA_ORG_ID,
      razorpay_key_id: 'rzp_test_apna_smartprint',
      razorpay_key_secret: 'secret_apna_print_2026',
      webhook_secret: 'webhook_secret_apna_print',
      mode: 'TEST',
      status: 'PENDING_VERIFICATION',
    });

    this.logSystem(
      'INFO',
      'BACKEND',
      'GITAM SMARTPRINT multi-tenant core initialized with tenant isolation and paise precision.',
      { organizationsCount: this.organizations.size, kiosksCount: this.kiosks.size }
    );
  }

  // ==========================================
  // ORGANIZATIONS & MEMBERS
  // ==========================================
  getOrganizations(): Organization[] {
    return Array.from(this.organizations.values());
  }

  getOrganization(id: string): Organization | undefined {
    return this.organizations.get(id);
  }

  getOrganizationBySlug(slug: string): Organization | undefined {
    const s = slug.toLowerCase();
    return Array.from(this.organizations.values()).find((o) => o.slug.toLowerCase() === s);
  }

  createOrganization(
    data: {
      name: string;
      slug: string;
      brand_colors?: Organization['brand_colors'];
      public_url?: string;
      logo_url?: string;
    },
    adminEmail = 'admin@gitam.edu'
  ): Organization {
    const slug = data.slug.toLowerCase().trim();
    if (this.getOrganizationBySlug(slug)) {
      throw new Error(`An organization with slug '${slug}' already exists.`);
    }

    const orgId = `org_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const newOrg: Organization = {
      id: orgId,
      name: data.name,
      slug,
      logo_url: data.logo_url,
      brand_colors: data.brand_colors || {
        primary: '#0d253f',
        secondary: '#1e40af',
        accent: '#ef4444',
        bg: '#ffffff',
      },
      public_url: data.public_url,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.organizations.set(orgId, newOrg);

    // Initialize Default Settings, Branding, Pricing & Payment for new Organization
    this.brandingConfigs.set(orgId, {
      ...DEFAULT_BRANDING,
      organization_id: orgId,
      organization: data.name,
    });

    this.pricingConfigs.set(orgId, {
      ...DEFAULT_PRICING,
      organization_id: orgId,
      bw_price_paise: 100,
      color_price_paise: 500,
    });

    this.paymentConfigs.set(orgId, {
      id: `paycfg_${orgId}`,
      organization_id: orgId,
      razorpay_key_id: '',
      razorpay_key_secret: '',
      webhook_secret: '',
      mode: 'TEST',
      status: 'NOT_CONFIGURED',
    });

    this.logAudit(adminEmail, 'CREATE_ORGANIZATION', 'organizations', orgId, { name: data.name, slug });
    this.logSystem('INFO', 'ADMIN', `Created new organization ${data.name} (${slug})`);

    return newOrg;
  }

  updateOrganization(id: string, updates: Partial<Organization>, adminEmail = 'admin@gitam.edu'): Organization | null {
    const org = this.organizations.get(id);
    if (!org) return null;

    const updated: Organization = {
      ...org,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.organizations.set(id, updated);
    this.logAudit(adminEmail, 'UPDATE_ORGANIZATION', 'organizations', id, updates);
    return updated;
  }

  getMemberByEmail(email: string): OrganizationMember | undefined {
    return this.members.get(email.toLowerCase());
  }

  getMembers(organizationId?: string): OrganizationMember[] {
    const list = Array.from(this.members.values());
    return organizationId ? list.filter((m) => m.organization_id === organizationId) : list;
  }

  getOrganizationsForMember(email: string): string[] {
    const normalized = email.toLowerCase();
    const mem = this.members.get(normalized);
    if (!mem) return [];
    if (mem.role === 'SUPER_ADMIN') {
      return Array.from(this.organizations.keys());
    }
    return [mem.organization_id];
  }

  addMember(member: Omit<OrganizationMember, 'id' | 'created_at'>, adminEmail = 'admin@gitam.edu'): OrganizationMember {
    const id = `mem_${Date.now().toString(36)}`;
    const newMember: OrganizationMember = {
      ...member,
      id,
      email: member.email.toLowerCase(),
      created_at: new Date().toISOString(),
    };
    this.members.set(newMember.email, newMember);
    this.logAudit(adminEmail, 'ADD_ORG_MEMBER', 'organization_members', id, {
      email: newMember.email,
      role: newMember.role,
      orgId: newMember.organization_id,
    });
    return newMember;
  }

  // ==========================================
  // LOCATIONS
  // ==========================================
  getLocations(organizationId?: string): Location[] {
    const list = Array.from(this.locations.values());
    return organizationId ? list.filter((l) => l.organization_id === organizationId) : list;
  }

  createLocation(data: Omit<Location, 'id' | 'created_at'>): Location {
    const id = `loc_${Date.now().toString(36)}`;
    const loc: Location = { ...data, id, created_at: new Date().toISOString() };
    this.locations.set(id, loc);
    return loc;
  }

  // ==========================================
  // BRANDING & PRICING
  // ==========================================
  getBranding(organizationId: string = GITAM_ORG_ID): BrandingConfig {
    return this.brandingConfigs.get(organizationId) || { ...DEFAULT_BRANDING };
  }

  updateBranding(organizationId: string, updates: Partial<BrandingConfig>, adminEmail = 'admin@gitam.edu'): BrandingConfig {
    const current = this.getBranding(organizationId);
    const updated: BrandingConfig = { ...current, ...updates, organization_id: organizationId };
    this.brandingConfigs.set(organizationId, updated);
    this.logAudit(adminEmail, 'UPDATE_BRANDING', 'branding', organizationId, updates);
    return updated;
  }

  getPricing(organizationId: string = GITAM_ORG_ID): PricingConfig {
    return this.pricingConfigs.get(organizationId) || { ...DEFAULT_PRICING };
  }

  updatePricing(organizationId: string, updates: Partial<PricingConfig>, adminEmail = 'admin@gitam.edu'): PricingConfig {
    const current = this.getPricing(organizationId);
    const updated: PricingConfig = {
      ...current,
      ...updates,
      organization_id: organizationId,
      bw_price_paise: updates.bw_price_per_page !== undefined ? Math.round(updates.bw_price_per_page * 100) : current.bw_price_paise,
      color_price_paise: updates.color_price_per_page !== undefined ? Math.round(updates.color_price_per_page * 100) : current.color_price_paise,
      updated_by: adminEmail,
      updated_at: new Date().toISOString(),
    };
    this.pricingConfigs.set(organizationId, updated);
    this.logAudit(adminEmail, 'UPDATE_PRICING', 'pricing', organizationId, updates);
    return updated;
  }

  // ==========================================
  // KIOSKS & DEVICES
  // ==========================================
  getKiosks(organizationId?: string): Kiosk[] {
    const list = Array.from(this.kiosks.values());
    return organizationId ? list.filter((k) => k.organization_id === organizationId) : list;
  }

  getKiosk(id: string): Kiosk | undefined {
    return this.kiosks.get(id);
  }

  getKioskBySlug(kioskSlug: string, organizationId?: string): Kiosk | undefined {
    const s = kioskSlug.toLowerCase();
    const list = this.getKiosks(organizationId);
    return list.find((k) => k.id.toLowerCase() === s || (k.kiosk_slug && k.kiosk_slug.toLowerCase() === s));
  }

  createKiosk(kiosk: Kiosk, adminEmail = 'admin@gitam.edu'): Kiosk {
    this.kiosks.set(kiosk.id, kiosk);
    this.logAudit(adminEmail, 'CREATE_KIOSK', 'kiosks', kiosk.id, { name: kiosk.name, location: kiosk.location });
    return kiosk;
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

  /**
   * Concurrency Control: Support one active customer print workflow per physical kiosk.
   * Atomically checks kiosk's active-job state and reserves it for that workflow.
   */
  reserveKioskForJob(kioskId: string, jobId: string): { success: boolean; error?: string } {
    const kiosk = this.kiosks.get(kioskId);
    if (!kiosk) {
      return { success: false, error: 'Kiosk not found.' };
    }

    if (kiosk.maintenance_mode || kiosk.status === 'MAINTENANCE' || kiosk.status === 'DISABLED') {
      return { success: false, error: 'Kiosk is currently under maintenance or disabled.' };
    }

    if (kiosk.active_job_id && kiosk.active_job_id !== jobId) {
      const activeJob = this.jobs.get(kiosk.active_job_id);
      if (activeJob) {
        const jobAgeMs = Date.now() - new Date(activeJob.created_at).getTime();
        const isStale = jobAgeMs > 3 * 60 * 1000; // 3 minutes timeout for abandoned pre-payment jobs

        // Only lock kiosk if an active job is actively in printing/device queue or very recently queued (< 3 mins)
        const isActivelyPrinting = [
          'PAYMENT_VERIFIED',
          'QUEUED',
          'DEVICE_ACCEPTED',
          'DOWNLOADING',
          'PROCESSING',
          'SUBMITTED_TO_CUPS',
          'PRINTING',
        ].includes(activeJob.status);

        if (isActivelyPrinting && !isStale) {
          return {
            success: false,
            error: 'Kiosk is currently processing a print job for another customer. Please wait for the current job to finish.',
          };
        }

        // If pre-payment job is very fresh (< 60s), notify customer
        if (!isStale && !isActivelyPrinting && jobAgeMs < 60 * 1000) {
          return {
            success: false,
            error: 'Another document is currently being prepared on this kiosk. Please retry in 1 minute.',
          };
        }
      }
    }

    kiosk.active_job_id = jobId;
    return { success: true };
  }

  releaseKioskJob(kioskId: string, jobId?: string): void {
    const kiosk = this.kiosks.get(kioskId);
    if (kiosk && (!jobId || kiosk.active_job_id === jobId)) {
      kiosk.active_job_id = null;
    }
  }

  getActiveJobForKiosk(kioskId: string): PrintJob | null {
    const kiosk = this.kiosks.get(kioskId);
    if (!kiosk || !kiosk.active_job_id) return null;
    const job = this.jobs.get(kiosk.active_job_id);
    if (!job) {
      kiosk.active_job_id = null;
      return null;
    }
    return job;
  }

  getDevices(organizationId?: string): Device[] {
    const list = Array.from(this.devices.values());
    return organizationId ? list.filter((d) => d.organization_id === organizationId) : list;
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

    // Update associated device
    const device = Array.from(this.devices.values()).find((d) => d.kiosk_id === kioskId);
    if (device) {
      device.status = kiosk.status;
      device.last_heartbeat = kiosk.last_heartbeat;
      if (telemetry.cpu_temp !== undefined) device.cpu_temp_celsius = telemetry.cpu_temp;
      if (telemetry.ram_usage !== undefined) device.ram_usage_percent = telemetry.ram_usage;
      if (telemetry.disk_usage !== undefined) device.disk_usage_percent = telemetry.disk_usage;
    }

    if (telemetry.printer_status) {
      const printer = Array.from(this.printers.values()).find((p) => p.kiosk_id === kioskId && p.is_default);
      if (printer) {
        printer.status = telemetry.printer_status;
        if (telemetry.printer_message) printer.last_error = telemetry.printer_message;
      }
    }

    return true;
  }

  // ==========================================
  // PRINTERS & PRINTER ROUTING
  // ==========================================
  getPrinters(organizationId?: string, kioskId?: string): Printer[] {
    let list = Array.from(this.printers.values());
    if (organizationId) list = list.filter((p) => p.organization_id === organizationId);
    if (kioskId) list = list.filter((p) => p.kiosk_id === kioskId);
    return list;
  }

  getPrinter(id: string): Printer | undefined {
    return this.printers.get(id);
  }

  createPrinter(printer: Printer, adminEmail = 'admin@gitam.edu'): Printer {
    this.printers.set(printer.id, printer);
    this.logAudit(adminEmail, 'CREATE_PRINTER', 'printers', printer.id, {
      name: printer.display_name,
      kioskId: printer.kiosk_id,
    });
    return printer;
  }

  updatePrinter(id: string, updates: Partial<Printer>, adminEmail = 'admin@gitam.edu'): Printer | null {
    const printer = this.printers.get(id);
    if (!printer) return null;
    const updated = { ...printer, ...updates, updated_at: new Date().toISOString() };
    this.printers.set(id, updated);
    this.logAudit(adminEmail, 'UPDATE_PRINTER', 'printers', id, updates);
    return updated;
  }

  getRouting(kioskId: string): PrinterRouting | undefined {
    return this.routings.get(kioskId);
  }

  getAllRoutings(organizationId?: string): PrinterRouting[] {
    const list = Array.from(this.routings.values());
    return organizationId ? list.filter((r) => r.organization_id === organizationId) : list;
  }

  updateRouting(kioskId: string, updates: Partial<PrinterRouting>, adminEmail = 'admin@gitam.edu'): PrinterRouting {
    const current = this.routings.get(kioskId) || {
      id: `route_${kioskId}`,
      kiosk_id: kioskId,
      auto_backup_enabled: true,
      updated_at: new Date().toISOString(),
    };
    const updated = { ...current, ...updates, updated_at: new Date().toISOString() };
    this.routings.set(kioskId, updated);
    this.logAudit(adminEmail, 'UPDATE_ROUTING', 'printer_routing', kioskId, updates);
    return updated;
  }

  /**
   * Safe Server-Side Printer Routing & Auto-failover
   */
  selectPrinterForJob(
    kioskId: string,
    isColor: boolean,
    isDuplex: boolean
  ): { success: boolean; printer?: Printer; error_message?: string } {
    const kiosk = this.kiosks.get(kioskId);
    if (!kiosk || kiosk.status === 'OFFLINE' || kiosk.status === 'DISABLED') {
      return { success: false, error_message: `Kiosk ${kioskId} is currently offline or disabled.` };
    }

    const routing = this.routings.get(kioskId);
    const printers = Array.from(this.printers.values()).filter((p) => p.kiosk_id === kioskId && p.enabled);

    if (printers.length === 0) {
      return { success: false, error_message: 'No enabled printers found at this kiosk.' };
    }

    let chosen: Printer | undefined;

    if (isColor) {
      if (routing?.color_primary_printer_id) {
        chosen = this.printers.get(routing.color_primary_printer_id);
      }
      if (!chosen || chosen.status !== 'READY' || (isDuplex && !chosen.supports_duplex)) {
        chosen = printers.find((p) => p.supports_color && p.status === 'READY' && (!isDuplex || p.supports_duplex));
      }
      if (!chosen && routing?.auto_backup_enabled && routing.color_backup_printer_id) {
        chosen = this.printers.get(routing.color_backup_printer_id);
      }
      if (!chosen || (isDuplex && !chosen.supports_duplex)) {
        return {
          success: false,
          error_message: isDuplex
            ? 'No color printer with two-sided (duplex) capability is currently ready.'
            : 'Color printer is currently unavailable or out of paper.',
        };
      }
      return { success: true, printer: chosen };
    } else {
      if (routing?.bw_primary_printer_id) {
        chosen = this.printers.get(routing.bw_primary_printer_id);
      }
      if (!chosen || chosen.status !== 'READY' || (isDuplex && !chosen.supports_duplex)) {
        chosen = printers.find((p) => !p.supports_color && p.status === 'READY' && (!isDuplex || p.supports_duplex));
      }
      if (!chosen && routing?.auto_backup_enabled && routing.bw_backup_printer_id) {
        chosen = this.printers.get(routing.bw_backup_printer_id);
      }
      if (!chosen || (isDuplex && !chosen.supports_duplex)) {
        chosen = printers.find((p) => p.status === 'READY' && (!isDuplex || p.supports_duplex));
      }
      if (!chosen) {
        return {
          success: false,
          error_message: isDuplex
            ? 'No printer with two-sided (duplex) capability is currently ready.'
            : 'B&W printer is currently offline or experiencing an error.',
        };
      }
      return { success: true, printer: chosen };
    }
  }

  // ==========================================
  // PAYMENTS & RAZORPAY CONFIGURATIONS
  // ==========================================
  getPaymentConfig(organizationId: string): PaymentConfiguration | undefined {
    return this.paymentConfigs.get(organizationId);
  }

  updatePaymentConfig(
    organizationId: string,
    updates: Partial<PaymentConfiguration>,
    adminEmail = 'admin@gitam.edu'
  ): PaymentConfiguration {
    const current = this.paymentConfigs.get(organizationId) || {
      id: `paycfg_${organizationId}`,
      organization_id: organizationId,
      razorpay_key_id: '',
      razorpay_key_secret: '',
      webhook_secret: '',
      mode: 'TEST',
      status: 'NOT_CONFIGURED',
    };

    const updated: PaymentConfiguration = {
      ...current,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.paymentConfigs.set(organizationId, updated);

    // Audit log masking secret keys
    this.logAudit(adminEmail, 'UPDATE_PAYMENT_CONFIG', 'payment_configurations', organizationId, {
      keyId: updates.razorpay_key_id ? updates.razorpay_key_id.slice(0, 8) + '***' : undefined,
      mode: updates.mode,
      status: updates.status,
    });

    return updated;
  }

  createPaymentOrder(order: PaymentOrder): PaymentOrder {
    this.paymentOrders.set(order.razorpay_order_id, order);
    return order;
  }

  getPaymentOrder(razorpayOrderId: string): PaymentOrder | undefined {
    return this.paymentOrders.get(razorpayOrderId);
  }

  createPayment(
    jobId: string,
    razorpayOrderId: string,
    amount: number,
    currency = 'INR',
    organizationId = GITAM_ORG_ID
  ): PaymentRecord {
    const payment: PaymentRecord = {
      id: `pay_rec_${Date.now().toString(36)}`,
      organization_id: organizationId,
      job_id: jobId,
      razorpay_order_id: razorpayOrderId,
      amount,
      amount_paise: Math.round(amount * 100),
      currency,
      status: 'PENDING',
      created_at: new Date().toISOString(),
    };
    this.payments.set(razorpayOrderId, payment);
    return payment;
  }

  verifyPayment(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    signature: string,
    organizationId?: string,
    jobId?: string
  ): PaymentRecord | null {
    let payment = this.payments.get(razorpayOrderId);
    if (!payment) {
      // Serverless fallback: look up by paymentOrder or fallback dynamically
      const po = this.getPaymentOrder(razorpayOrderId) || Array.from(this.paymentOrders.values()).find(p => p.razorpay_order_id === razorpayOrderId);
      const targetOrg = organizationId || po?.organization_id || GITAM_ORG_ID;
      const targetJobId = jobId || po?.job_id || `SP-${razorpayOrderId.slice(-8)}`;
      payment = this.createPayment(targetJobId, razorpayOrderId, ((po?.amount_paise || 100) / 100), 'INR', targetOrg);
    }

    if (organizationId && payment.organization_id && payment.organization_id !== organizationId) {
      this.logSystem('CRITICAL', 'WEBHOOK', 'Cross-tenant payment verification attempt rejected!', {
        paymentOrg: payment.organization_id,
        targetOrg: organizationId,
      });
      return null;
    }

    payment.razorpay_payment_id = razorpayPaymentId;
    payment.status = 'SUCCESS';
    payment.verified_at = new Date().toISOString();

    const job = this.jobs.get(payment.job_id);
    if (job) {
      job.payment_id = razorpayPaymentId;
      job.status = 'PAYMENT_VERIFIED';
    }

    return payment;
  }

  recordWebhookEvent(eventId: string, organizationId: string, eventType: string, payload: Record<string, unknown>): boolean {
    if (this.webhookEvents.has(eventId)) {
      return false; // Already processed - idempotent deduplication
    }
    this.webhookEvents.set(eventId, {
      id: eventId,
      organization_id: organizationId,
      event_type: eventType,
      payload,
      processed_at: new Date().toISOString(),
    });
    return true;
  }

  hasWebhookEvent(eventId: string): boolean {
    return this.webhookEvents.has(eventId);
  }

  getPayments(organizationId?: string): PaymentRecord[] {
    const list = Array.from(this.payments.values());
    return organizationId ? list.filter((p) => p.organization_id === organizationId) : list;
  }

  // ==========================================
  // SESSIONS
  // ==========================================
  createSession(kioskId: string, organizationId: string = GITAM_ORG_ID): Session {
    const id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const token = `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins expiry

    const session: Session = {
      id,
      organization_id: organizationId,
      kiosk_id: kioskId,
      session_token: token,
      status: 'ACTIVE',
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    };

    this.sessions.set(token, session);
    return session;
  }

  getSession(token: string): Session | undefined {
    return this.sessions.get(token);
  }

  // ==========================================
  // PRINT JOBS & FILES
  // ==========================================
  createJob(
    job: Partial<PrintJob> & {
      id: string;
      kiosk_id: string;
      pages_total: number;
      calculated_amount: number;
      idempotency_key?: string;
    }
  ): PrintJob {
    const now = new Date().toISOString();
    const fullJob: PrintJob = {
      pages_selected: 'All',
      copies: 1,
      is_color: false,
      is_duplex: false,
      orientation: 'portrait',
      paper_size: 'A4',
      idempotency_key: job.idempotency_key || `idemp_${job.id}_${Date.now()}`,
      ...job,
      organization_id: job.organization_id || GITAM_ORG_ID,
      status: job.status || 'CREATED',
      amount_paise: job.amount_paise || Math.round(job.calculated_amount * 100),
      created_at: job.created_at || now,
    };
    this.jobs.set(fullJob.id, fullJob);
    this.logSystem('INFO', 'BACKEND', `Print Job ${fullJob.id} registered [Tenant: ${fullJob.organization_id}]`, {
      kioskId: fullJob.kiosk_id,
      pages: fullJob.pages_total,
      copies: fullJob.copies,
    });
    return fullJob;
  }

  getJob(id: string): PrintJob | undefined {
    return this.jobs.get(id);
  }

  getAllJobs(organizationId?: string): PrintJob[] {
    const list = Array.from(this.jobs.values());
    return organizationId ? list.filter((j) => j.organization_id === organizationId) : list;
  }

  getPendingJobsForKiosk(kioskId: string): PrintJob[] {
    return Array.from(this.jobs.values()).filter(
      (j) =>
        j.kiosk_id === kioskId &&
        (j.status === 'PAYMENT_VERIFIED' || j.status === 'QUEUED')
    );
  }

  updateJobStatus(
    id: string,
    status: PrintJobStatus,
    details?: { cups_job_id?: number; error_message?: string; recovery_reason?: string }
  ): PrintJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;

    job.status = status;
    if (details?.cups_job_id) job.cups_job_id = details.cups_job_id;
    if (details?.error_message) job.error_message = details.error_message;
    if (details?.recovery_reason) job.recovery_reason = details.recovery_reason;
    if (status === 'COMPLETED') job.completed_at = new Date().toISOString();

    return job;
  }

  registerFile(
    jobId: string,
    originalFilename: string,
    mimeType: string,
    sizeBytes: number,
    pageCount: number,
    storagePath: string | null,
    organizationId = GITAM_ORG_ID
  ): FileMetadata {
    const fileId = `file_${Date.now().toString(36)}`;
    const metadata: FileMetadata = {
      id: fileId,
      organization_id: organizationId,
      job_id: jobId,
      storage_path: storagePath,
      storage_bucket: 'smartprint-temporary',
      original_filename: originalFilename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      page_count: pageCount,
      status: 'TEMPORARY',
      created_at: new Date().toISOString(),
    };
    this.files.set(jobId, metadata);
    return metadata;
  }

  deleteJobFile(jobId: string): boolean {
    const file = this.files.get(jobId);
    if (!file) return false;

    file.storage_path = null;
    file.status = 'DELETED';
    file.deleted_at = new Date().toISOString();
    return true;
  }

  // ==========================================
  // CLEANUP & COMMAND QUEUES
  // ==========================================
  createCleanupJob(jobId: string, organizationId: string, objectKey: string): CleanupJob {
    const id = `clean_${Date.now().toString(36)}`;
    const cleanJob: CleanupJob = {
      id,
      organization_id: organizationId,
      job_id: jobId,
      storage_bucket: 'smartprint-temporary',
      object_key: objectKey,
      status: 'PENDING',
      attempts: 0,
      created_at: new Date().toISOString(),
    };
    this.cleanupJobs.set(id, cleanJob);
    return cleanJob;
  }

  getPendingCleanupJobs(): CleanupJob[] {
    return Array.from(this.cleanupJobs.values()).filter((c) => c.status === 'PENDING' || c.status === 'RETRYING');
  }

  markCleanupJob(id: string, status: CleanupJob['status'], error?: string): void {
    const job = this.cleanupJobs.get(id);
    if (job) {
      job.status = status;
      job.attempts += 1;
      if (error) job.error_message = error;
      if (status === 'COMPLETED') job.executed_at = new Date().toISOString();
    }
  }

  // ==========================================
  // AUDIT & SYSTEM LOGS
  // ==========================================
  logSystem(
    level: SystemLog['level'],
    component: SystemLog['component'],
    message: string,
    metadata?: Record<string, unknown>,
    organizationId?: string,
    kioskId?: string,
    jobId?: string
  ) {
    const log: SystemLog = {
      id: `syslog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      level,
      component,
      organization_id: organizationId,
      kiosk_id: kioskId,
      job_id: jobId,
      message,
      metadata,
      created_at: new Date().toISOString(),
    };
    this.systemLogs.unshift(log);
    if (this.systemLogs.length > 500) this.systemLogs.pop();
  }

  logAudit(
    adminEmail: string,
    action: string,
    targetType: string,
    targetId?: string,
    details?: Record<string, unknown>,
    organizationId?: string
  ) {
    const log: AuditLog = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      admin_email: adminEmail,
      action,
      target_type: targetType,
      target_id: targetId,
      details,
      organization_id: organizationId,
      created_at: new Date().toISOString(),
    };
    this.auditLogs.unshift(log);
    if (this.auditLogs.length > 500) this.auditLogs.pop();
  }

  getSystemLogs(limit = 50, organizationId?: string): SystemLog[] {
    const list = organizationId ? this.systemLogs.filter((l) => !l.organization_id || l.organization_id === organizationId) : this.systemLogs;
    return list.slice(0, limit);
  }

  getAuditLogs(limit = 50, organizationId?: string): AuditLog[] {
    const list = organizationId ? this.auditLogs.filter((l) => !l.organization_id || l.organization_id === organizationId) : this.auditLogs;
    return list.slice(0, limit);
  }
}

// Global Singleton Export
export const store = new StateManager();
