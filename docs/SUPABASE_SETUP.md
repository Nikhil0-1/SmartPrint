# Supabase PostgreSQL Database & Storage Setup Guide

## Overview
GITAM SMARTPRINT utilizes Supabase for relational PostgreSQL data storage, Row Level Security (RLS), and private temporary file storage in the `print-temp` bucket.

---

## 1. Migrations Execution

Run the provided SQL migrations in order via Supabase Dashboard SQL Editor or CLI:

1. `supabase/migrations/001_initial_schema.sql` (Initial 16-table ecosystem schema)
2. `supabase/migrations/002_multi_printer_routing.sql` (Multi-printer capability detection & routing tables)

---

## 2. Database Tables Summary

| Table | Description |
| --- | --- |
| `admins` | Admin credentials mapped to Firebase UID |
| `admin_roles` | Admin role assignments (`SUPER_ADMIN`, `OPERATOR`) |
| `kiosks` | Raspberry Pi kiosk hardware registry & telemetry |
| `printers` | Physical CUPS printers and capabilities |
| `printer_routing` | Primary & backup printer routing configuration |
| `sessions` | Dynamic QR code sessions & expiry tokens |
| `print_jobs` | Print job state machine & idempotency keys |
| `print_attempts` | Audit execution history of CUPS print submissions |
| `files` | Ephemeral temporary document storage metadata |
| `payments` | Verified Razorpay UPI payment transaction ledger |
| `pricing` | Per-page rates (B&W ₹1, Color ₹5) & limits |
| `branding` | Kiosk branding text, taglines, & support numbers |
| `system_logs` | System telemetry and hardware component logs |
| `admin_audit_logs` | Administrative changes audit trail |
| `health_metrics` | Hardware time-series metrics |
| `notifications` | Critical admin alerts for hardware faults |

---

## 3. Private Storage Bucket (`print-temp`)

Create a private Supabase Storage Bucket:
- **Bucket Name:** `print-temp`
- **Public Access:** Disabled (`Public = false`)
- **Retention Policy:** Ephemeral (Files purged immediately post-print)
