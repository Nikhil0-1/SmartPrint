export type PrintJobStatus =
  | 'CREATED'
  | 'UPLOAD_COMPLETE'
  | 'VALIDATING'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_VERIFIED'
  | 'QUEUED'
  | 'DEVICE_ACCEPTED'
  | 'DOWNLOADING'
  | 'PROCESSING'
  | 'SUBMITTED_TO_CUPS'
  | 'PRINTING'
  | 'PRINTED'
  | 'PRINT_COMPLETION_REPORTED'
  | 'CLEANUP_PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'DEVICE_OFFLINE'
  | 'PRINTER_UNAVAILABLE'
  | 'DRIVER_UNAVAILABLE'
  | 'RECOVERY_REQUIRED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

export type KioskStatus = 'ONLINE' | 'OFFLINE' | 'MAINTENANCE' | 'DISABLED';

export type KioskMonitorState =
  | 'IDLE'
  | 'DOCUMENT_RECEIVED'
  | 'PROCESSING'
  | 'PRINTING'
  | 'COMPLETED'
  | 'ERROR'
  | 'RECOVERY_REQUIRED'
  | 'MAINTENANCE';

export type PrinterStatus =
  | 'READY'
  | 'PRINTING'
  | 'BUSY'
  | 'ERROR'
  | 'PAPER_OUT'
  | 'OFFLINE'
  | 'UNKNOWN'
  | 'NOT_SUPPORTED';

export type OrgStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export type AdminRole = 'SUPER_ADMIN' | 'ORG_ADMIN' | 'OPERATOR';

export interface Organization {
  id: string; // uuid
  name: string;
  slug: string;
  logo_url?: string;
  brand_colors: {
    primary: string;
    secondary: string;
    accent: string;
    bg: string;
  };
  public_url?: string;
  status: OrgStatus;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  firebase_uid: string;
  email: string;
  full_name: string;
  role: AdminRole;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  created_at: string;
}

export interface Location {
  id: string;
  organization_id: string;
  name: string;
  address?: string;
  description?: string;
  created_at: string;
}

export interface BrandingConfig {
  organization_id?: string;
  organization: string;
  product: string;
  primary_tagline: string;
  secondary_tagline: string;
  powered_by: string;
  support_number: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  bg_color: string;
  logo_url?: string;
  welcome_message: string;
  instructions: string;
  success_message: string;
  maintenance_message: string;
}

export interface PricingConfig {
  organization_id?: string;
  bw_price_per_page: number;
  color_price_per_page: number;
  bw_price_paise?: number;
  color_price_paise?: number;
  service_charge: number;
  min_order_amount: number;
  max_pages: number;
  max_copies: number;
  max_file_size_mb: number;
  currency?: string;
  updated_by: string;
  updated_at: string;
}

export interface Device {
  id: string; // e.g., RPI-GITAM-SPK-001
  organization_id: string;
  kiosk_id: string;
  device_token_hash: string;
  status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE' | 'REVOKED';
  ip_address?: string;
  mac_address?: string;
  last_heartbeat?: string;
  cpu_temp_celsius?: number;
  ram_usage_percent?: number;
  disk_usage_percent?: number;
  agent_version: string;
  created_at?: string;
  updated_at?: string;
}

export interface Kiosk {
  id: string; // e.g., GITAM-SPK-001
  organization_id?: string;
  location_id?: string;
  kiosk_slug?: string;
  name: string;
  location: string;
  device_token_hash: string;
  status: KioskStatus;
  ip_address: string;
  mac_address?: string;
  last_heartbeat: string;
  cpu_temp_celsius?: number;
  ram_usage_percent?: number;
  disk_usage_percent?: number;
  agent_version: string;
  maintenance_mode: boolean;
  permanent_qr_url?: string;
  active_job_id?: string | null;
}

export type PrinterType = 'BW' | 'COLOR' | 'BOTH' | 'BACKUP';

export interface PrinterCapabilities {
  color: boolean;
  grayscale: boolean;
  duplex: boolean;
  paper_sizes: string[];
  resolutions?: string[];
  cups_state?: string;
  queue_state?: string;
  last_detected_at?: string;
}

export interface Printer {
  id: string;
  organization_id?: string;
  kiosk_id: string;
  printer_name: string;
  display_name: string;
  manufacturer: string;
  model: string;
  cups_queue_name: string;
  connection_type: 'USB' | 'IP' | 'NETWORK';
  status: PrinterStatus;
  printer_type: PrinterType;
  enabled: boolean;
  priority: number;
  is_default: boolean;
  supports_color: boolean;
  supports_duplex: boolean;
  capabilities?: PrinterCapabilities;
  last_test_print?: string;
  last_error?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PrinterRouting {
  id: string;
  organization_id?: string;
  kiosk_id: string;
  bw_primary_printer_id?: string | null;
  bw_backup_printer_id?: string | null;
  color_primary_printer_id?: string | null;
  color_backup_printer_id?: string | null;
  auto_backup_enabled: boolean;
  updated_at?: string;
}

export interface Session {
  id: string;
  organization_id?: string;
  kiosk_id: string;
  session_token: string;
  status: 'ACTIVE' | 'IN_USE' | 'COMPLETED' | 'EXPIRED';
  expires_at: string;
  created_at: string;
}

export interface PrintJob {
  id: string; // e.g., SP-20261006-001
  organization_id?: string;
  session_id?: string;
  kiosk_id: string;
  printer_id?: string;
  status: PrintJobStatus;
  pages_total: number;
  pages_selected: string; // 'All' or '1-3'
  copies: number;
  is_color: boolean;
  is_duplex: boolean;
  orientation: 'portrait' | 'landscape';
  paper_size: string;
  calculated_amount: number; // in Rupees for display
  amount_paise?: number; // integer paise for exact ledger
  pricing_snapshot?: Record<string, unknown>;
  idempotency_key: string;
  payment_id?: string;
  print_attempt_id?: string;
  cups_job_id?: number;
  error_message?: string;
  recovery_reason?: string;
  created_at: string;
  completed_at?: string;
  signed_download_url?: string;
  original_filename?: string;
  storage_object_key?: string;
}

export interface FileMetadata {
  id: string;
  organization_id?: string;
  job_id: string;
  storage_path: string | null;
  storage_bucket?: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  page_count: number;
  status: 'TEMPORARY' | 'PROCESSING' | 'DELETED' | 'CLEANUP_FAILED';
  created_at: string;
  deleted_at?: string;
}

export type PaymentConfigStatus =
  | 'NOT_CONFIGURED'
  | 'PENDING_VERIFICATION'
  | 'CONFIGURED'
  | 'VERIFICATION_FAILED'
  | 'DISABLED';

export interface PaymentConfiguration {
  id: string;
  organization_id: string;
  razorpay_key_id: string;
  razorpay_key_secret?: string; // Masked when returned to client
  webhook_secret?: string; // Masked when returned to client
  mode: 'TEST' | 'LIVE';
  status: PaymentConfigStatus;
  verified_at?: string;
  last_error?: string;
  updated_at?: string;
}

export interface PaymentOrder {
  id: string;
  organization_id: string;
  job_id: string;
  razorpay_order_id: string;
  amount_paise: number;
  currency: string;
  status: 'CREATED' | 'ATTEMPTED' | 'PAID' | 'EXPIRED';
  created_at: string;
}

export interface PaymentRecord {
  id: string;
  organization_id?: string;
  job_id: string;
  razorpay_order_id: string;
  razorpay_payment_id?: string;
  amount: number;
  amount_paise?: number;
  currency: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
  created_at: string;
  verified_at?: string;
}

export interface WebhookEventRecord {
  id: string;
  organization_id?: string;
  event_type: string;
  payload: Record<string, unknown>;
  processed_at: string;
}

export interface CleanupJob {
  id: string;
  organization_id: string;
  job_id: string;
  storage_bucket: string;
  object_key: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'RETRYING';
  attempts: number;
  error_message?: string;
  created_at: string;
  executed_at?: string;
}

export interface DeviceCommand {
  id: string;
  device_id: string;
  organization_id: string;
  command_type: 'TEST_PRINT' | 'CANCEL_JOB' | 'RESTART_SERVICE' | 'FLUSH_SPOOL' | 'SYNC_CONFIG';
  payload: Record<string, unknown>;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
  expires_at: string;
  created_at: string;
  acknowledged_at?: string;
  result?: Record<string, unknown>;
}

export interface SystemLog {
  id: string;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  component: 'RASPBERRY_PI' | 'CUPS' | 'BACKEND' | 'WEBHOOK' | 'CLEANUP' | 'ADMIN' | 'STORAGE';
  organization_id?: string;
  kiosk_id?: string;
  job_id?: string;
  message: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface AuditLog {
  id: string;
  organization_id?: string;
  admin_email: string;
  action: string;
  target_type: string;
  target_id?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}
