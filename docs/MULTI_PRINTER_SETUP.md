# Multi-Printer Architecture & Routing Setup Guide

## Overview
GITAM SMARTPRINT is architected from day one to support multiple physical USB printers connected to a single Raspberry Pi kiosk controller. This guide details printer capability detection, server-side printer selection, automatic backup routing, and administrative controls.

---

## 1. Multi-Printer Architecture

```
                       Raspberry Pi 3B+ Kiosk
                                 │
           ┌─────────────────────┴─────────────────────┐
           ▼                                           ▼
   USB Printer 1 (B&W)                         USB Printer 2 (Color)
   HP LaserJet Pro M404dn                      HP Color LaserJet Pro M454dn
   CUPS: smartprint_bw_01                      CUPS: smartprint_color_01
```

---

## 2. Server-Side Printer Routing Rules

The backend controls printer selection dynamically based on customer choices and hardware capabilities.

### Routing Execution Flow:
1. Customer selects **B&W** or **COLOR** on mobile web app.
2. Server queries `printer_routing` table for kiosk (`GITAM-SPK-001`).
3. Server evaluates Primary Printer status (`enabled: true`, `status: 'READY'`).
4. If Primary Printer is `OFFLINE` or out of paper AND `auto_backup_enabled` is true:
   - Server checks `bw_backup_printer_id` / `color_backup_printer_id`.
   - Verifies backup printer capability match (e.g. duplex, paper size).
   - If safe, routes job to backup printer and logs `ROUTING OVERRIDE`.
5. If no capable printer is online:
   - Rejects checkout with safe error: `"Color printing is temporarily unavailable."`

---

## 3. Capability Matching Safety Rules
- **Color Jobs:** Never sent to a B&W-only printer.
- **Duplex Jobs:** Never sent to a printer without double-sided hardware.
- **Paper Sizes:** Verified against supported paper sizes (`A4`).
- **Disk Space Guard:** If Pi storage > 92%, new job checkout is paused.
