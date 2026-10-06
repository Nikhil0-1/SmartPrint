export type PrintJobStatus =
  | 'CREATED'
  | 'UPLOAD_COMPLETE'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_VERIFIED'
  | 'QUEUED'
  | 'DOWNLOADING'
  | 'PROCESSING'
  | 'SUBMITTED_TO_CUPS'
  | 'PRINTING'
  | 'PRINTED'
  | 'CLEANUP_PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RECOVERY_REQUIRED'
  | 'CANCELLED'
  | 'EXPIRED';

export type KioskStatus = 'ONLINE' | 'OFFLINE' | 'MAINTENANCE' | 'DISABLED';

export type PrinterStatus = 'READY' | 'PRINTING' | 'BUSY' | 'ERROR' | 'PAPER_OUT' | 'OFFLINE' | 'UNKNOWN';

export interface BrandingConfig {
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
  bw_price_per_page: number;
  color_price_per_page: number;
  service_charge: number;
  min_order_amount: number;
  max_pages: number;
  max_copies: number;
  max_file_size_mb: number;
  updated_by: string;
  updated_at: string;
}

export interface Kiosk {
  id: string; // e.g., GITAM-SPK-001
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
}

export interface Printer {
  id: string;
  kiosk_id: string;
  printer_name: string;
  model: string;
  cups_queue_name: string;
  connection_type: 'USB';
  status: PrinterStatus;
  is_default: boolean;
  supports_color: boolean;
  supports_duplex: boolean;
  last_test_print?: string;
  last_error?: string;
}

export interface Session {
  id: string;
  kiosk_id: string;
  session_token: string;
  status: 'ACTIVE' | 'IN_USE' | 'COMPLETED' | 'EXPIRED';
  expires_at: string;
  created_at: string;
}

export interface PrintJob {
  id: string; // e.g., SP-20261006-001
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
  calculated_amount: number;
  idempotency_key: string;
  payment_id?: string;
  print_attempt_id?: string;
  cups_job_id?: number;
  error_message?: string;
  recovery_reason?: string;
  created_at: string;
  completed_at?: string;
  // Temporary file access only during processing
  signed_download_url?: string;
  original_filename?: string;
}

export interface FileMetadata {
  id: string;
  job_id: string;
  storage_path: string | null;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  page_count: number;
  status: 'TEMPORARY' | 'PROCESSING' | 'DELETED' | 'CLEANUP_FAILED';
  created_at: string;
  deleted_at?: string;
}

export interface PaymentRecord {
  id: string;
  job_id: string;
  razorpay_order_id: string;
  razorpay_payment_id?: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
  created_at: string;
  verified_at?: string;
}

export interface SystemLog {
  id: string;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  component: 'RASPBERRY_PI' | 'CUPS' | 'BACKEND' | 'WEBHOOK' | 'CLEANUP' | 'ADMIN';
  kiosk_id?: string;
  job_id?: string;
  message: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface AuditLog {
  id: string;
  admin_email: string;
  action: string;
  target_type: string;
  target_id?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}
