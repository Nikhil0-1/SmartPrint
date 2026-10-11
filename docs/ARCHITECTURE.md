# GITAM SMARTPRINT — Complete System Architecture

## 1. System Topology & Multi-Tenant Hierarchy

GITAM SMARTPRINT is an autonomous, multi-tenant, zero-retention cloud & IoT printing platform designed for campus and organizational deployments.

```mermaid
graph TD
    subgraph MultiTenantHierarchy["Multi-Tenant Hierarchy"]
        SA[Platform Super Admin] --> Org1[Organization 1: GITAM SMARTPRINT]
        SA --> Org2[Organization 2: APNA SMART PRINTER]
        Org1 --> OA1[Organization Admin]
        Org1 --> Loc1[Location: Central Library]
        Loc1 --> Kiosk1[Kiosk: GITAM-SPK-001]
        Kiosk1 --> RPi1[Raspberry Pi 3B+ Controller]
        RPi1 --> Mon1[HDMI Kiosk Monitor - Light Mode]
        RPi1 --> Prn1[CUPS Queue: HP LaserJet USB]
        Prn1 --> Job1[Print Jobs]
    end
```

---

## 2. Component Architecture

```mermaid
graph LR
    subgraph Clients["Edge & Mobile Clients"]
        Mobile["Customer Mobile Web<br/>/print/gitam/gitam-spk-001"]
        KioskMon["HDMI Kiosk Monitor<br/>/kiosk/GITAM-SPK-001"]
        AdminUI["Admin Web Console<br/>/admin"]
    end

    subgraph CloudBackend["Next.js 16 + Supabase Backend"]
        API["REST & Server Actions<br/>Next.js 16 App Router"]
        Store["State Engine &<br/>Concurrency Manager"]
        DB[("Supabase PostgreSQL<br/>Multi-Tenant DB")]
        Storage[("Supabase Storage<br/>smartprint-temporary")]
        Realtime["Supabase Realtime<br/>Postgres Replication"]
    end

    subgraph PaymentGateway["Payment Processing"]
        RZP["Razorpay Gateway<br/>Per-Organization Credentials"]
    end

    subgraph IoTEdge["Raspberry Pi 3B+ Edge Controller"]
        Agent["smartprint_agent.py<br/>Outbound TLS Poller"]
        StateDB[("SQLite<br/>agent_state.db")]
        CUPS["Linux CUPS 2.4<br/>cups_controller.py"]
        Printer["HP LaserJet USB<br/>Physical Output"]
    end

    Mobile -->|1. Upload File & Options| API
    Mobile -->|2. UPI Checkout| RZP
    RZP -->|3. Signed Webhook| API
    API --> Store
    Store --> DB
    Store --> Realtime
    Realtime -.->|Live Notifications| KioskMon
    KioskMon -->|Authoritative Status Fetch| API
    Agent -->|Outbound Polling & Job Fetch| API
    Agent --> Storage
    Agent --> StateDB
    Agent --> CUPS
    CUPS --> Printer
```

---

## 3. Technology Stack & Fixed Architectural Decisions

- **Frontend Application**: React 19 / Next.js 16 (App Router), Vanilla CSS & TailwindCSS with Light/White + Amber Accent palette.
- **Authentication**: Firebase Authentication with server-side token validation and database role authorization.
- **Database**: Supabase PostgreSQL with multi-tenant row-level security and atomic reservation functions.
- **File Storage**: Private Supabase Storage bucket (`smartprint-temporary`) via provider-independent `IStorageService` abstraction.
- **Live Updates**: Supabase Realtime for instant event push + fallback authoritative HTTP polling.
- **Payments**: Razorpay configured per organization with integer paise precision and raw webhook signature verification.
- **Controller Hardware**: Raspberry Pi 3B+ (ARMv7 / aarch64) running Raspberry Pi OS Lite.
- **Monitor Display**: Dedicated HDMI monitor in fullscreen Chromium/Cage kiosk mode running strict state machine.
- **Print Engine**: Linux CUPS (Common Unix Printing System) with native IPP/raster drivers.
