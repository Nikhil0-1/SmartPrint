/**
 * GITAM SMARTPRINT — Supabase Database Persistence Layer
 *
 * This module is the AUTHORITATIVE source for all persistent settings:
 * branding, pricing, payment_configurations, organization_members,
 * organizations, kiosks, printers, print_jobs, audit logs, and webhooks.
 *
 * NEVER read from the in-memory store for persistent data that belongs here.
 * The store is retained only for transient session state.
 */

import { supabaseAdmin } from './supabase';
import { randomBytes } from 'crypto';

// ─── Type aliases ───────────────────────────────────────────────────────────

export interface DbOrganization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  brand_colors: { primary: string; secondary: string; accent: string; bg: string } | null;
  public_url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DbMember {
  id: string;
  organization_id: string;
  firebase_uid: string;
  email: string;
  full_name: string;
  role: 'SUPER_ADMIN' | 'ORG_ADMIN' | 'OPERATOR';
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DbBranding {
  id: string;
  organization_id: string;
  organization: string;
  product: string;
  primary_tagline: string;
  secondary_tagline: string;
  powered_by: string | null;
  support_number: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  bg_color: string;
  logo_url: string | null;
  welcome_message: string | null;
  instructions: string | null;
  success_message: string | null;
  maintenance_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbPricing {
  id: string;
  organization_id: string;
  bw_price_per_page: number;
  color_price_per_page: number;
  bw_price_paise: number;
  color_price_paise: number;
  service_charge: number;
  min_order_amount: number;
  max_pages: number;
  max_copies: number;
  max_file_size_mb: number;
  updated_by: string | null;
  updated_at: string;
}

export interface DbPaymentConfig {
  id: string;
  organization_id: string;
  razorpay_key_id: string;
  razorpay_key_secret_encrypted: string;
  webhook_secret_encrypted: string;
  mode: 'TEST' | 'LIVE';
  status: string;
  verified_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export interface DbKiosk {
  id: string;
  organization_id: string | null;
  location_id: string | null;
  name: string;
  location: string;
  device_token_hash: string;
  status: string;
  ip_address: string | null;
  mac_address: string | null;
  last_heartbeat: string | null;
  cpu_temp_celsius: number | null;
  ram_usage_percent: number | null;
  disk_usage_percent: number | null;
  agent_version: string | null;
  maintenance_mode: boolean;
  kiosk_slug: string | null;
  active_job_id: string | null;
  updated_at: string;
}

export interface DbPrinter {
  id: string;
  organization_id: string | null;
  kiosk_id: string | null;
  printer_name: string;
  display_name: string | null;
  manufacturer: string | null;
  model: string | null;
  cups_queue_name: string;
  connection_type: string;
  status: string;
  printer_type: string | null;
  enabled: boolean;
  priority: number;
  is_default: boolean;
  supports_color: boolean;
  supports_duplex: boolean;
  capabilities: Record<string, unknown> | null;
  last_test_print: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbAuditLog {
  id: string;
  admin_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  organization_id: string | null;
  created_at: string;
}

export interface DbWebhookEvent {
  id: string;
  organization_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  processed_at: string;
}

export type PrintJobStatus =
  | 'CREATED'
  | 'UPLOAD_COMPLETE'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_VERIFIED'
  | 'QUEUED'
  | 'DISPATCHED'
  | 'ACKNOWLEDGED'
  | 'DOWNLOADING'
  | 'PROCESSING'
  | 'SUBMITTED_TO_CUPS'
  | 'PRINTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RECOVERY_REQUIRED'
  | 'CANCELLED'
  | 'PRINTER_OFFLINE'
  | 'PAYMENT_FAILED'
  | 'OUTCOME_UNCERTAIN';

export interface DbPrintJob {
  id: string;
  organization_id: string;
  session_id: string | null;
  kiosk_id: string;
  printer_id: string | null;
  status: PrintJobStatus;
  queue_sequence?: number;
  queued_at?: string | null;
  customer_access_token?: string;
  worker_lease_id?: string | null;
  lease_expires_at?: string | null;
  dispatched_at?: string | null;
  acknowledged_at?: string | null;
  retry_count: number;
  max_retries: number;
  pages_total: number;
  pages_selected: string;
  copies: number;
  is_color: boolean;
  is_duplex: boolean;
  orientation: string;
  paper_size: string;
  calculated_amount: number;
  amount_paise: number;
  idempotency_key: string;
  document_name?: string | null;
  file_storage_path?: string | null;
  file_url?: string | null;
  cups_job_id?: number | null;
  error_message?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export interface DbQueueStatus {
  job_id: string;
  printer_id: string | null;
  printer_name: string;
  queue_sequence: number;
  jobs_ahead: number;
  queue_position: number;
  status: PrintJobStatus | string;
  status_label: string;
  estimated_wait_seconds: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return Boolean(url && key && !url.includes('placeholder') && !key.includes('placeholder'));
}

// ─── Organizations ────────────────────────────────────────────────────────────

export async function dbGetOrganizations(): Promise<DbOrganization[]> {
  if (!isConfigured()) return [];
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[DB] getOrganizations error:', error.message);
    return [];
  }
  return data || [];
}

export async function dbGetOrganization(id: string): Promise<DbOrganization | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return null;
  return data;
}

export async function dbGetOrganizationBySlug(slug: string): Promise<DbOrganization | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('*')
    .eq('slug', slug.toLowerCase())
    .single();
  if (error) return null;
  return data;
}

export async function dbCreateOrganization(
  org: Omit<DbOrganization, 'id' | 'created_at' | 'updated_at'>
): Promise<DbOrganization | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .insert({ ...org, slug: org.slug.toLowerCase() })
    .select()
    .single();
  if (error) {
    console.error('[DB] createOrganization error:', error.message);
    return null;
  }
  return data;
}

export async function dbUpdateOrganization(
  id: string,
  updates: Partial<DbOrganization>
): Promise<DbOrganization | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    console.error('[DB] updateOrganization error:', error.message);
    return null;
  }
  return data;
}

// ─── Members ──────────────────────────────────────────────────────────────────

export async function dbGetMemberByEmail(email: string): Promise<DbMember | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('organization_members')
    .select('*')
    .eq('email', email.toLowerCase())
    .eq('status', 'ACTIVE')
    .single();
  if (error) return null;
  return data;
}

export async function dbGetMemberByFirebaseUid(uid: string): Promise<DbMember | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('organization_members')
    .select('*')
    .eq('firebase_uid', uid)
    .eq('status', 'ACTIVE')
    .single();
  if (error) return null;
  return data;
}

export async function dbGetMembersByOrg(organizationId: string): Promise<DbMember[]> {
  if (!isConfigured()) return [];
  const { data, error } = await supabaseAdmin
    .from('organization_members')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return data || [];
}

export async function dbUpsertMember(
  member: Omit<DbMember, 'id' | 'created_at' | 'updated_at'>
): Promise<DbMember | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('organization_members')
    .upsert(
      {
        ...member,
        email: member.email.toLowerCase(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,email', ignoreDuplicates: false }
    )
    .select()
    .single();
  if (error) {
    console.error('[DB] upsertMember error:', error.message);
    return null;
  }
  return data;
}

export async function dbUpdateMemberFirebaseUid(email: string, firebaseUid: string): Promise<void> {
  if (!isConfigured()) return;
  await supabaseAdmin
    .from('organization_members')
    .update({ firebase_uid: firebaseUid, updated_at: new Date().toISOString() })
    .eq('email', email.toLowerCase());
}

// ─── Branding ─────────────────────────────────────────────────────────────────

export async function dbGetBranding(organizationId: string): Promise<DbBranding | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('branding')
    .select('*')
    .eq('organization_id', organizationId)
    .single();
  if (error) return null;
  return data;
}

export async function dbUpsertBranding(
  organizationId: string,
  updates: Partial<Omit<DbBranding, 'id' | 'created_at'>>
): Promise<DbBranding | null> {
  if (!isConfigured()) return null;

  // Check if branding record exists
  const existing = await dbGetBranding(organizationId);
  const now = new Date().toISOString();

  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('branding')
      .update({ ...updates, updated_at: now })
      .eq('organization_id', organizationId)
      .select()
      .single();
    if (error) {
      console.error('[DB] updateBranding error:', error.message);
      return null;
    }
    return data;
  } else {
    const { data, error } = await supabaseAdmin
      .from('branding')
      .insert({ ...updates, organization_id: organizationId, created_at: now, updated_at: now })
      .select()
      .single();
    if (error) {
      console.error('[DB] insertBranding error:', error.message);
      return null;
    }
    return data;
  }
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

export async function dbGetPricing(organizationId: string): Promise<DbPricing | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('pricing')
    .select('*')
    .eq('organization_id', organizationId)
    .single();
  if (error) return null;
  return data;
}

export async function dbUpsertPricing(
  organizationId: string,
  updates: Partial<Omit<DbPricing, 'id'>>
): Promise<DbPricing | null> {
  if (!isConfigured()) return null;

  const existing = await dbGetPricing(organizationId);
  const now = new Date().toISOString();

  // Automatically compute paise values from per-page prices if provided
  const pricePaise: Partial<DbPricing> = {};
  if (updates.bw_price_per_page !== undefined) {
    pricePaise.bw_price_paise = Math.round(updates.bw_price_per_page * 100);
  }
  if (updates.color_price_per_page !== undefined) {
    pricePaise.color_price_paise = Math.round(updates.color_price_per_page * 100);
  }

  const payload = { ...updates, ...pricePaise, updated_at: now };

  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('pricing')
      .update(payload)
      .eq('organization_id', organizationId)
      .select()
      .single();
    if (error) {
      console.error('[DB] updatePricing error:', error.message);
      return null;
    }
    return data;
  } else {
    const { data, error } = await supabaseAdmin
      .from('pricing')
      .insert({ ...payload, organization_id: organizationId })
      .select()
      .single();
    if (error) {
      console.error('[DB] insertPricing error:', error.message);
      return null;
    }
    return data;
  }
}

// ─── Payment Configurations ───────────────────────────────────────────────────
// IMPORTANT: Secrets are stored in columns named `razorpay_key_secret_encrypted`
// and `webhook_secret_encrypted`. In a future iteration these should be encrypted
// at rest using a KMS. For now they are stored as-is server-side only and NEVER
// returned to browser clients.

export async function dbGetPaymentConfig(organizationId: string): Promise<DbPaymentConfig | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('payment_configurations')
    .select('*')
    .eq('organization_id', organizationId)
    .single();
  if (error) return null;
  return data;
}

export async function dbUpsertPaymentConfig(
  organizationId: string,
  updates: {
    razorpay_key_id?: string;
    razorpay_key_secret?: string; // plain — stored in _encrypted column server-side only
    webhook_secret?: string;      // plain — stored in _encrypted column server-side only
    mode?: 'TEST' | 'LIVE';
    status?: string;
    verified_at?: string | null;
    last_error?: string | null;
  }
): Promise<DbPaymentConfig | null> {
  if (!isConfigured()) return null;

  const existing = await dbGetPaymentConfig(organizationId);
  const now = new Date().toISOString();

  const payload: Record<string, unknown> = { updated_at: now };
  if (updates.razorpay_key_id !== undefined) payload.razorpay_key_id = updates.razorpay_key_id;
  if (updates.razorpay_key_secret !== undefined) payload.razorpay_key_secret_encrypted = updates.razorpay_key_secret;
  if (updates.webhook_secret !== undefined) payload.webhook_secret_encrypted = updates.webhook_secret;
  if (updates.mode !== undefined) payload.mode = updates.mode;
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.verified_at !== undefined) payload.verified_at = updates.verified_at;
  if (updates.last_error !== undefined) payload.last_error = updates.last_error;

  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('payment_configurations')
      .update(payload)
      .eq('organization_id', organizationId)
      .select()
      .single();
    if (error) {
      console.error('[DB] updatePaymentConfig error:', error.message);
      return null;
    }
    return data;
  } else {
    const { data, error } = await supabaseAdmin
      .from('payment_configurations')
      .insert({ ...payload, organization_id: organizationId })
      .select()
      .single();
    if (error) {
      console.error('[DB] insertPaymentConfig error:', error.message);
      return null;
    }
    return data;
  }
}

// ─── Kiosks ───────────────────────────────────────────────────────────────────

export async function dbGetKiosks(organizationId?: string): Promise<DbKiosk[]> {
  if (!isConfigured()) return [];
  let query = supabaseAdmin.from('kiosks').select('*').order('id', { ascending: true });
  if (organizationId) query = query.eq('organization_id', organizationId);
  const { data, error } = await query;
  if (error) {
    console.error('[DB] getKiosks error:', error.message);
    return [];
  }
  return data || [];
}

export async function dbGetKiosk(id: string): Promise<DbKiosk | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('kiosks')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return null;
  return data;
}

export async function dbUpdateKioskHeartbeat(
  kioskId: string,
  telemetry: {
    cpu_temp_celsius?: number;
    ram_usage_percent?: number;
    disk_usage_percent?: number;
    agent_version?: string;
    ip_address?: string;
    status?: string;
  }
): Promise<void> {
  if (!isConfigured()) return;
  await supabaseAdmin
    .from('kiosks')
    .update({
      ...telemetry,
      last_heartbeat: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', kioskId);
}

export async function dbUpdateKioskStatus(kioskId: string, status: string): Promise<void> {
  if (!isConfigured()) return;
  await supabaseAdmin
    .from('kiosks')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', kioskId);
}

export async function dbMarkKiosksOffline(thresholdMinutes = 2): Promise<void> {
  if (!isConfigured()) return;
  const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString();
  await supabaseAdmin
    .from('kiosks')
    .update({ status: 'OFFLINE', updated_at: new Date().toISOString() })
    .lt('last_heartbeat', cutoff)
    .neq('status', 'MAINTENANCE')
    .neq('status', 'DISABLED');
}

// ─── Devices ──────────────────────────────────────────────────────────────────

export async function dbUpdateDeviceHeartbeat(
  deviceId: string,
  telemetry: {
    cpu_temp_celsius?: number;
    ram_usage_percent?: number;
    disk_usage_percent?: number;
    agent_version?: string;
    ip_address?: string;
    status?: string;
  }
): Promise<void> {
  if (!isConfigured()) return;
  await supabaseAdmin
    .from('devices')
    .update({
      ...telemetry,
      last_heartbeat: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', deviceId);
}

// ─── Printers ─────────────────────────────────────────────────────────────────

export async function dbGetPrinters(organizationId?: string, kioskId?: string): Promise<DbPrinter[]> {
  if (!isConfigured()) return [];
  let query = supabaseAdmin.from('printers').select('*').order('priority', { ascending: true });
  if (organizationId) query = query.eq('organization_id', organizationId);
  if (kioskId) query = query.eq('kiosk_id', kioskId);
  const { data, error } = await query;
  if (error) {
    console.error('[DB] getPrinters error:', error.message);
    return [];
  }
  return data || [];
}

export async function dbGetPrinter(id: string): Promise<DbPrinter | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin.from('printers').select('*').eq('id', id).single();
  if (error) return null;
  return data;
}

export async function dbCreatePrinter(printer: Omit<DbPrinter, 'id' | 'created_at' | 'updated_at'>): Promise<DbPrinter | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('printers')
    .insert({ ...printer })
    .select()
    .single();
  if (error) {
    console.error('[DB] createPrinter error:', error.message);
    return null;
  }
  return data;
}

export async function dbUpdatePrinter(id: string, updates: Partial<DbPrinter>): Promise<DbPrinter | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('printers')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    console.error('[DB] updatePrinter error:', error.message);
    return null;
  }
  return data;
}

// ─── Webhook Events (Idempotency) ─────────────────────────────────────────────

export async function dbHasWebhookEvent(eventId: string): Promise<boolean> {
  if (!isConfigured()) return false;
  const { data, error } = await supabaseAdmin
    .from('webhook_events')
    .select('id')
    .eq('id', eventId)
    .single();
  if (error) return false;
  return Boolean(data);
}

export async function dbRecordWebhookEvent(
  eventId: string,
  organizationId: string | null,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!isConfigured()) return;
  await supabaseAdmin
    .from('webhook_events')
    .upsert(
      {
        id: eventId,
        organization_id: organizationId,
        event_type: eventType,
        payload,
        processed_at: new Date().toISOString(),
      },
      { onConflict: 'id', ignoreDuplicates: true }
    );
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export async function dbGetPaymentOrder(razorpayOrderId: string): Promise<Record<string, unknown> | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('payment_orders')
    .select('*')
    .eq('razorpay_order_id', razorpayOrderId)
    .single();
  if (error) return null;
  return data;
}

export async function dbCreatePaymentOrder(order: {
  job_id: string;
  organization_id: string;
  razorpay_order_id: string;
  amount_paise: number;
  currency?: string;
}): Promise<Record<string, unknown> | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('payment_orders')
    .insert({ ...order, currency: order.currency || 'INR', status: 'CREATED' })
    .select()
    .single();
  if (error) {
    console.error('[DB] createPaymentOrder error:', error.message);
    return null;
  }
  return data;
}

export async function dbRecordPaymentTransaction(tx: {
  job_id: string;
  organization_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  amount_paise: number;
  currency?: string;
  raw_payload?: Record<string, unknown>;
}): Promise<void> {
  if (!isConfigured()) return;
  await supabaseAdmin.from('payment_transactions').upsert(
    {
      ...tx,
      currency: tx.currency || 'INR',
      status: 'SUCCESS',
      verified_at: new Date().toISOString(),
    },
    { onConflict: 'razorpay_payment_id', ignoreDuplicates: true }
  );
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export async function dbWriteAuditLog(log: {
  admin_email: string;
  action: string;
  target_type: string;
  target_id?: string | null;
  details?: Record<string, unknown> | null;
  ip_address?: string | null;
  organization_id?: string | null;
}): Promise<void> {
  if (!isConfigured()) return;
  await supabaseAdmin.from('admin_audit_logs').insert({
    ...log,
    created_at: new Date().toISOString(),
  });
}

export async function dbGetAuditLogs(
  organizationId?: string,
  limit = 50
): Promise<DbAuditLog[]> {
  if (!isConfigured()) return [];
  let query = supabaseAdmin
    .from('admin_audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (organizationId) query = query.eq('organization_id', organizationId);
  const { data, error } = await query;
  if (error) return [];
  return data || [];
}

// ─── System Logs ──────────────────────────────────────────────────────────────

export async function dbWriteSystemLog(log: {
  level: string;
  component: string;
  kiosk_id?: string | null;
  job_id?: string | null;
  message: string;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  if (!isConfigured()) return;
  await supabaseAdmin.from('system_logs').insert({
    ...log,
    created_at: new Date().toISOString(),
  });
}

// ─── Device Commands ──────────────────────────────────────────────────────────

export async function dbCreateDeviceCommand(cmd: {
  device_id: string;
  organization_id: string;
  command_type: string;
  payload?: Record<string, unknown>;
  expires_at: string;
}): Promise<Record<string, unknown> | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('device_commands')
    .insert({
      ...cmd,
      payload: cmd.payload || {},
      status: 'PENDING',
    })
    .select()
    .single();
  if (error) {
    console.error('[DB] createDeviceCommand error:', error.message);
    return null;
  }
  return data;
}

export async function dbGetPendingCommands(deviceId: string): Promise<Record<string, unknown>[]> {
  if (!isConfigured()) return [];
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('device_commands')
    .select('*')
    .eq('device_id', deviceId)
    .eq('status', 'PENDING')
    .gt('expires_at', now)
    .order('created_at', { ascending: true })
    .limit(10);
  if (error) return [];
  return data || [];
}

export async function dbUpdateDeviceCommandStatus(
  commandId: string,
  status: string,
  result?: Record<string, unknown>
): Promise<void> {
  if (!isConfigured()) return;
  await supabaseAdmin
    .from('device_commands')
    .update({
      status,
      result: result || null,
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', commandId);
}

// ─── Locations ────────────────────────────────────────────────────────────────

export async function dbGetLocations(organizationId?: string): Promise<Record<string, unknown>[]> {
  if (!isConfigured()) return [];
  let query = supabaseAdmin.from('locations').select('*').order('created_at', { ascending: true });
  if (organizationId) query = query.eq('organization_id', organizationId);
  const { data, error } = await query;
  if (error) return [];
  return data || [];
}

// ─── FIFO Print Queue & Job Operations ────────────────────────────────────────

/**
 * Creates a persistent print job with a secure customer access token and idempotency key.
 */
export async function dbCreatePrintJob(job: {
  id: string;
  organization_id: string;
  session_id?: string | null;
  kiosk_id: string;
  printer_id?: string | null;
  pages_total?: number;
  pages_selected?: string;
  copies?: number;
  is_color?: boolean;
  is_duplex?: boolean;
  orientation?: string;
  paper_size?: string;
  calculated_amount: number;
  amount_paise?: number;
  idempotency_key?: string;
  document_name?: string | null;
  file_storage_path?: string | null;
  file_url?: string | null;
  status?: PrintJobStatus;
}): Promise<DbPrintJob | null> {
  if (!isConfigured()) return null;

  const accessToken = randomBytes(24).toString('hex');
  const amountPaise = job.amount_paise || Math.round(job.calculated_amount * 100);
  const idempotencyKey = job.idempotency_key || `idmp_${job.id}_${Date.now()}`;

  const newJob: Partial<DbPrintJob> = {
    id: job.id,
    organization_id: job.organization_id,
    session_id: job.session_id || null,
    kiosk_id: job.kiosk_id,
    printer_id: job.printer_id || null,
    status: job.status || 'CREATED',
    pages_total: job.pages_total ?? 1,
    pages_selected: job.pages_selected || 'All',
    copies: job.copies ?? 1,
    is_color: Boolean(job.is_color),
    is_duplex: Boolean(job.is_duplex),
    orientation: job.orientation || 'portrait',
    paper_size: job.paper_size || 'A4',
    calculated_amount: job.calculated_amount,
    amount_paise: amountPaise,
    idempotency_key: idempotencyKey,
    customer_access_token: accessToken,
    document_name: job.document_name || null,
    file_storage_path: job.file_storage_path || null,
    file_url: job.file_url || null,
    retry_count: 0,
    max_retries: 3,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('print_jobs')
    .insert(newJob)
    .select()
    .single();

  if (error) {
    console.error('[DB] createPrintJob error:', error.message);
    return null;
  }
  return data;
}

/**
 * Retrieves a print job by its primary ID.
 */
export async function dbGetPrintJob(id: string): Promise<DbPrintJob | null> {
  if (!isConfigured()) return null;
  const { data, error } = await supabaseAdmin
    .from('print_jobs')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return null;
  return data;
}

/**
 * Privacy-preserving lookup: customer retrieves only their own job via unguessable access token.
 * Prevents enumeration or access to other customers' jobs.
 */
export async function dbGetPrintJobByToken(accessToken: string): Promise<DbPrintJob | null> {
  if (!isConfigured() || !accessToken) return null;
  const { data, error } = await supabaseAdmin
    .from('print_jobs')
    .select('*')
    .eq('customer_access_token', accessToken)
    .single();
  if (error) return null;
  return data;
}

/**
 * Enqueues a verified job into the physical printer's FIFO queue.
 * Sets status to QUEUED and records queued_at timestamp.
 */
export async function dbEnqueuePrintJob(
  jobId: string,
  printerId?: string
): Promise<DbPrintJob | null> {
  if (!isConfigured()) return null;

  const updates: Record<string, unknown> = {
    status: 'QUEUED',
    queued_at: new Date().toISOString(),
  };
  if (printerId) updates.printer_id = printerId;

  const { data, error } = await supabaseAdmin
    .from('print_jobs')
    .update(updates)
    .eq('id', jobId)
    .select()
    .single();

  if (error) {
    console.error('[DB] enqueuePrintJob error:', error.message);
    return null;
  }
  return data;
}

/**
 * Atomically claims the next eligible FIFO job for a kiosk or physical printer.
 * Uses PostgreSQL RPC function with SELECT FOR UPDATE SKIP LOCKED to prevent
 * multiple workers or concurrent dispatches from claiming the same job.
 */
export async function dbClaimNextPrintJob(
  kioskId: string,
  workerId: string,
  leaseSeconds = 60,
  printerId?: string
): Promise<DbPrintJob | null> {
  if (!isConfigured()) return null;

  // Try RPC claim_next_print_job first
  const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('claim_next_print_job', {
    p_kiosk_id: kioskId,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
    p_printer_id: printerId || null,
  });

  if (!rpcError && rpcData && rpcData.length > 0) {
    return rpcData[0] as DbPrintJob;
  }

  // Fallback transactional claim if RPC migration is pending
  const now = new Date();
  const leaseExpires = new Date(now.getTime() + leaseSeconds * 1000).toISOString();

  // Find oldest queued job
  let query = supabaseAdmin
    .from('print_jobs')
    .select('*')
    .eq('kiosk_id', kioskId)
    .eq('status', 'QUEUED')
    .order('queue_sequence', { ascending: true })
    .order('queued_at', { ascending: true })
    .limit(1);

  if (printerId) query = query.eq('printer_id', printerId);

  const { data: candidates } = await query;
  if (!candidates || candidates.length === 0) return null;

  const candidate = candidates[0];

  // Atomically claim candidate with lease
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('print_jobs')
    .update({
      status: 'DISPATCHED',
      worker_lease_id: workerId,
      dispatched_at: now.toISOString(),
      lease_expires_at: leaseExpires,
    })
    .eq('id', candidate.id)
    .eq('status', 'QUEUED') // Optimistic locking guard
    .select()
    .single();

  if (claimErr || !claimed) return null;
  return claimed;
}

/**
 * Worker acknowledges receipt of job and provides initial CUPS job id.
 */
export async function dbAcknowledgePrintJob(
  jobId: string,
  workerId: string,
  cupsJobId?: number
): Promise<void> {
  if (!isConfigured()) return;
  const updates: Record<string, unknown> = {
    status: 'ACKNOWLEDGED',
    acknowledged_at: new Date().toISOString(),
  };
  if (cupsJobId) updates.cups_job_id = cupsJobId;

  await supabaseAdmin
    .from('print_jobs')
    .update(updates)
    .eq('id', jobId)
    .eq('worker_lease_id', workerId);
}

/**
 * Updates status of a print job with timestamp and error auditing.
 */
export async function dbUpdatePrintJobStatus(
  jobId: string,
  status: PrintJobStatus,
  errorMessage?: string,
  cupsJobId?: number
): Promise<void> {
  if (!isConfigured()) return;

  const updates: Record<string, unknown> = {
    status,
  };
  if (errorMessage !== undefined) updates.error_message = errorMessage;
  if (cupsJobId !== undefined) updates.cups_job_id = cupsJobId;
  if (status === 'COMPLETED') updates.completed_at = new Date().toISOString();

  await supabaseAdmin
    .from('print_jobs')
    .update(updates)
    .eq('id', jobId);
}

/**
 * Calculates deterministic queue position and wait estimates for customer UI.
 */
export async function dbGetJobQueuePosition(jobId: string): Promise<DbQueueStatus | null> {
  if (!isConfigured()) return null;

  // Try RPC function first
  const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('get_job_queue_position', {
    p_job_id: jobId,
  });

  if (!rpcError && rpcData && rpcData.length > 0) {
    return rpcData[0] as DbQueueStatus;
  }

  // Fallback calculation in Node.js
  const job = await dbGetPrintJob(jobId);
  if (!job) return null;

  let printerName = 'Assigned Printer';
  if (job.printer_id) {
    const printer = await dbGetPrinter(job.printer_id);
    if (printer) printerName = printer.display_name || printer.printer_name;
  }

  if (!job.printer_id) {
    return {
      job_id: job.id,
      printer_id: null,
      printer_name: printerName,
      queue_sequence: job.queue_sequence || 0,
      jobs_ahead: 0,
      queue_position: 1,
      status: job.status,
      status_label: getFriendlyStatusLabel(job.status, 0),
      estimated_wait_seconds: 0,
    };
  }

  // Count jobs ahead in queue for the same printer
  const { count } = await supabaseAdmin
    .from('print_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('printer_id', job.printer_id)
    .in('status', ['QUEUED', 'DISPATCHED', 'ACKNOWLEDGED', 'SUBMITTED_TO_CUPS', 'PRINTING'])
    .lt('queue_sequence', job.queue_sequence || Number.MAX_SAFE_INTEGER);

  const jobsAhead = count || 0;
  const position = jobsAhead + 1;

  return {
    job_id: job.id,
    printer_id: job.printer_id,
    printer_name: printerName,
    queue_sequence: job.queue_sequence || 0,
    jobs_ahead: jobsAhead,
    queue_position: position,
    status: job.status,
    status_label: getFriendlyStatusLabel(job.status, jobsAhead),
    estimated_wait_seconds: jobsAhead * 20,
  };
}

function getFriendlyStatusLabel(status: PrintJobStatus | string, jobsAhead: number): string {
  switch (status) {
    case 'CREATED':
    case 'PAYMENT_PENDING':
      return 'Waiting for payment confirmation';
    case 'PAYMENT_VERIFIED':
      return 'Payment verified';
    case 'QUEUED':
      return jobsAhead === 0 ? 'Your document is next in queue' : `Added to print queue (${jobsAhead} ahead)`;
    case 'DISPATCHED':
    case 'ACKNOWLEDGED':
      return 'Printer is preparing your document';
    case 'SUBMITTED_TO_CUPS':
    case 'PRINTING':
      return 'Printing started';
    case 'COMPLETED':
      return 'Printing completed';
    case 'PRINTER_OFFLINE':
      return 'Printer temporarily offline';
    case 'FAILED':
    case 'RECOVERY_REQUIRED':
      return 'Print failed — assistance required';
    case 'CANCELLED':
      return 'Job cancelled';
    default:
      return status;
  }
}

/**
 * Intelligent and safe printer selection strictly scoped to the job's organization.
 * Rejects cross-tenant routing and handles hardware capability matching.
 */
export async function dbSelectBestPrinterForJob(
  kioskId: string,
  isColor: boolean,
  isDuplex: boolean,
  organizationId?: string
): Promise<{ printer: DbPrinter | null; error?: string }> {
  if (!isConfigured()) return { printer: null, error: 'Database not configured' };

  let query = supabaseAdmin
    .from('printers')
    .select('*')
    .eq('kiosk_id', kioskId)
    .eq('enabled', true)
    .neq('status', 'OFFLINE');

  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }

  const { data: printers, error } = await query.order('priority', { ascending: true });

  if (error || !printers || printers.length === 0) {
    return { printer: null, error: 'No ready printers available for this kiosk.' };
  }

  // Filter by color requirement
  let candidates = printers;
  if (isColor) {
    candidates = candidates.filter((p) => p.supports_color);
    if (candidates.length === 0) {
      return { printer: null, error: 'No color-capable printers available at this kiosk.' };
    }
  }

  // Filter by duplex requirement if specified
  if (isDuplex) {
    const duplexCandidates = candidates.filter((p) => p.supports_duplex);
    if (duplexCandidates.length > 0) candidates = duplexCandidates;
  }

  // Pick first available matching candidate
  const selected = candidates.find((p) => p.status === 'READY') || candidates[0];
  return { printer: selected as DbPrinter };
}
