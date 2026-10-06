# GITAM SMARTPRINT - TECHNICAL ARCHITECTURE

## 1. System Topology

GITAM SMARTPRINT is partitioned into four major layers:

```
┌────────────────────────────────────────────────────────────────┐
│                   1. CLIENT LAYER                              │
│  - Customer Mobile Web App (Responsive / Touch-optimized)      │
│  - Raspberry Pi HDMI Kiosk Screen (1080p Chromium Kiosk)       │
│  - Admin Web Console (Multi-tenant Campus Operations)          │
└────────────────┬───────────────────────────────▲───────────────┘
                 │ HTTPS                         │ HTTPS / Realtime
                 ▼                               │
┌────────────────────────────────────────────────┴───────────────┐
│                   2. CLOUD BACKEND LAYER                       │
│  - Next.js 16 App Router Server Actions & REST APIs            │
│  - Dynamic Session Generator & QR Token Dispatcher             │
│  - Server-side PDF Page Analyzer & Pricing Engine              │
│  - Ephemeral Memory / Private Storage Gateway                  │
│  - Razorpay Order & Webhook Signature Verifier (HMAC-SHA256)   │
│  - Idempotency & Single-Print Job State Machine                │
└────────────────┬───────────────────────────────────────────────┘
                 │ Secure Outbound Polling / HTTPS
                 ▼
┌────────────────────────────────────────────────────────────────┐
│                   3. LOCAL CONTROLLER LAYER                    │
│  - Raspberry Pi 3B+ (ARMv7 Linux / systemd daemons)            │
│  - SmartPrint Python Agent (`smartprint_agent.py`)             │
│  - Outbound-only TLS client (No incoming router ports needed)   │
│  - Local Idempotency State Store (`agent_state.db`)            │
│  - Secure local workspace (`/var/lib/smartprint/jobs/<id>`)   │
│  - CUPS Controller & IPP Job Poller (`cups_controller.py`)     │
│  - Secure File Overwriting & Wiping Engine (`shred -u`)        │
└────────────────┬───────────────────────────────────────────────┘
                 │ High-Speed USB 2.0 Cable
                 ▼
┌────────────────────────────────────────────────────────────────┐
│                   4. HARDWARE PRINTER LAYER                    │
│  - HP LaserJet Professional Series Printer                      │
│  - Direct USB connection (No Wi-Fi dependencies)              │
│  - CUPS Queue: `HP_LaserJet_USB`                               │
│  - A4 Plain Paper Output Tray                                  │
└────────────────────────────────────────────────────────────────┘
```

## 2. Job State Machine & Transitions

Every print request follows an immutable, strictly ordered lifecycle:

```
[CREATED]
    │  Customer selects kiosk
    ▼
[UPLOAD_COMPLETE]
    │  Server validates MIME/size & extracts PDF page count via pdf-lib
    ▼
[PAYMENT_PENDING]
    │  Razorpay order created with server-verified amount
    ▼
[PAYMENT_VERIFIED]
    │  HMAC SHA256 signature verified; exactly 1 print job authorized
    ▼
[QUEUED]
    │  Assigned to kiosk queue
    ▼
[DOWNLOADING]
    │  Pi Agent fetches document via short-lived signed URL
    ▼
[PROCESSING]
    │  Document validated locally on Pi (/var/lib/smartprint/jobs/<id>)
    ▼
[SUBMITTED_TO_CUPS]
    │  Passed to CUPS daemon via pycups / lp CLI
    ▼
[PRINTING]
    │  Printer actively marks paper
    ▼
[PRINTED]
    │  CUPS reports IPP_JOB_COMPLETED
    ▼
[CLEANUP_PENDING]
    │  Local shredding (/var/lib/smartprint/jobs/<id>) & Cloud memory purge
    ▼
[COMPLETED]
    │  Document access references nullified; audit log recorded
    ▼
[READY] (Kiosk displays refreshed QR code)
```

## 3. Network & Security Guarantees
- **Zero Inbound Ports on Pi**: Raspberry Pi makes strictly outbound HTTPS requests to the cloud backend. No port forwarding or public IP is required.
- **Idempotency Guard**: Every transaction has an `idempotency_key`. The Pi Agent records processed keys in a local SQLite database and refuses to re-print duplicate orders even during network retries or power interruptions.
- **Ephemeral Storage**: Customer documents are treated as temporary volatile memory. Normal successful prints trigger immediate multi-layer wiping (`shred -u` on disk, memory buffer destruction, storage path nullification).
