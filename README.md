# GITAM SMARTPRINT
## Autonomous Smart Campus Printing Kiosk Ecosystem

> **SCAN. UPLOAD. PAY. PRINT.**  
> *Smart Campus Printing, Made Simple.*  
> **Powered by Nikhil** | **For Enquiry & Support: 9006496970**

---

## 1. Overview

**GITAM SMARTPRINT** is a production-grade smart printing kiosk ecosystem designed for modern educational campuses. It solves the friction of traditional printing by eliminating flash drives, computer lab queues, and operator bottlenecks.

The ecosystem connects:
1. **Customer Mobile Web App**: Instant drag-and-drop document upload, server-side PDF page calculation, transparent live pricing, and UPI payment.
2. **Raspberry Pi 3B+ Print Controller**: Dedicated Linux IoT print controller communicating outbound-only with the cloud backend.
3. **USB HP Printer & CUPS**: Physical USB integration using Common Unix Printing System (CUPS) and HPLIP drivers.
4. **HDMI Desktop Monitor**: Fullscreen Chromium kiosk display showing a dynamic session QR code with auto-refresh and hardware status badges.
5. **Production Admin Panel**: Real-time fleet monitor, telemetry dashboard, printer management, price manager, dynamic branding, audit logs, and hardware simulator.
6. **Zero-Retention Ephemeral Document Security**: Bank-grade document lifecycle where customer documents are private, short-lived, and permanently shredded immediately after verified printing.

---

## 2. Complete Physical & Logical Architecture

```
CUSTOMER (Mobile Phone)
   │
   │ 1. Scan Dynamic QR
   ▼
MOBILE WEB APP (/print)
   │
   │ 2. Upload Document (PDF/PNG/JPG)
   ▼
CLOUD PRIVATE STORAGE / MEMORY BUFFER
   │
   │ 3. Server-side page validation & price quote
   ▼
RAZORPAY / UPI PAYMENT
   │
   │ 4. Webhook / signature verified
   ▼
EXACTLY 1 PRINT AUTHORIZATION
   │
   │ 5. Outbound poll / notification
   ▼
RASPBERRY PI 3B+ AGENT (/var/lib/smartprint/jobs/<id>)
   │
   │ 6. USB Cable
   ▼
HP LASERJET PRINTER (CUPS Queue)
   │
   │ 7. Print verified via lpstat
   ▼
AUTOMATIC DESTRUCTION:
  ├── Local Shredding on Raspberry Pi
  ├── Cloud Document Purged
  └── Database File Reference Nullified
   │
   ▼
READY FOR NEXT CUSTOMER
```

---

## 3. Key Specifications

| Parameter | Specification |
|---|---|
| **Organization** | GITAM (Configurable in Admin) |
| **Product** | SMARTPRINT |
| **Primary Tagline** | SCAN. UPLOAD. PAY. PRINT. |
| **Secondary Tagline** | Smart Campus Printing, Made Simple. |
| **Support Phone** | 9006496970 |
| **Credit** | Powered by Nikhil |
| **Local Controller** | Raspberry Pi 3B+ (ARMv7 Linux / Raspberry Pi OS) |
| **Printer Connection** | Physical USB Cable (No Wi-Fi dependencies) |
| **Display** | Desktop Monitor via Raspberry Pi HDMI (1080p Kiosk Mode) |
| **Default Rates** | B&W: ₹1.00 / page \| Color: ₹5.00 / page (Admin configurable) |
| **Security Principle** | Zero-retention ephemeral customer document storage |

---

## 4. Repository Structure

```
c:\Users\DELL\Desktop\GITAM\
├── src/
│   ├── app/
│   │   ├── api/             # Backend API routes (health, kiosk, customer, webhooks)
│   │   ├── kiosk/[kioskId]/ # Raspberry Pi HDMI fullscreen Kiosk screen
│   │   ├── print/           # Customer mobile web application
│   │   ├── admin/           # Comprehensive admin panel
│   │   ├── layout.tsx       # Root layout & meta tags
│   │   └── page.tsx         # Campus landing page & student portal
│   ├── components/          # Reusable UI components (Footer, etc.)
│   └── lib/                 # Types, store, constants, fileSecurity, razorpay, supabase
├── raspberry-pi/
│   ├── agent/               # smartprint_agent.py, cups_controller.py
│   ├── scripts/             # install.sh, printer_setup.sh, kiosk_setup.sh, health_check.sh, cleanup.sh
│   └── systemd/             # smartprint-agent.service, smartprint-kiosk.service
├── supabase/
│   └── migrations/          # 001_initial_schema.sql (complete DB schema & RLS)
├── docs/                    # Complete production documentation
├── .env.example             # Environment configuration template
└── README.md
```

---

## 5. Quick Start (Web Application)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env.local
```

### 3. Run Development Server
```bash
npm run dev
```

Open in browser:
- **Landing Page**: [http://localhost:3000](http://localhost:3000)
- **Customer Mobile Web App**: [http://localhost:3000/print?kiosk_id=GITAM-SPK-001](http://localhost:3000/print?kiosk_id=GITAM-SPK-001)
- **Raspberry Pi HDMI Kiosk Screen**: [http://localhost:3000/kiosk/GITAM-SPK-001](http://localhost:3000/kiosk/GITAM-SPK-001)
- **Admin Management Console**: [http://localhost:3000/admin](http://localhost:3000/admin)

---

## 6. Raspberry Pi 3B+ Deployment

1. Flash **Raspberry Pi OS Lite** (or with Desktop) onto a microSD card.
2. Clone repository or copy `raspberry-pi/` directory onto Pi at `/opt/smartprint`.
3. Run the automated installer:
   ```bash
   sudo bash /opt/smartprint/raspberry-pi/scripts/install.sh
   ```
4. Connect the HP Printer using a USB cable and run printer setup:
   ```bash
   sudo bash /opt/smartprint/raspberry-pi/scripts/printer_setup.sh
   ```
5. Run the hardware health diagnostic:
   ```bash
   sudo bash /opt/smartprint/raspberry-pi/scripts/health_check.sh
   ```
6. Start and enable system services:
   ```bash
   sudo systemctl start smartprint-agent.service smartprint-kiosk.service
   ```

---

## 7. Support & Maintenance

For questions, campus kiosk deployments, or technical support:
- **Phone / WhatsApp**: 9006496970
- **Lead Developer**: Nikhil
- **Institution**: GITAM
