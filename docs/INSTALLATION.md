# GITAM SMARTPRINT — Complete Installation Guide

## Overview
This guide provides step-by-step instructions for deploying the **GITAM SMARTPRINT** automated printing kiosk ecosystem across Next.js Web App, Supabase PostgreSQL & Storage, Firebase Admin Auth, Razorpay Payment Gateway, and Raspberry Pi 3B+ CUPS Print Agents.

---

## 1. System Requirements

### Hardware
- **Primary Kiosk Controller:** Raspberry Pi 3B+ (or Pi 4 / Pi 5)
- **Kiosk Display:** 1080p Desktop Monitor connected via HDMI (Non-touch)
- **Printers:** HP USB Printers (Single or Multi-Printer setup: B&W and Color)
- **Network:** Ethernet or Wi-Fi with internet connectivity

### Software Dependencies
- **Server / Web Host:** Node.js 18+ & Next.js 16+
- **Raspberry Pi OS:** Raspberry Pi OS 64-bit (Bullseye or Bookworm)
- **CUPS Printing System:** `cups`, `cups-client`, `cups-bsd`, `hplip`, `printer-driver-hpcups`
- **Python Runtime:** Python 3 rounded with `pycups`, `requests`, `urllib3`
- **Browser:** Chromium in headless kiosk mode (`--kiosk --noerrdialogs`)

---

## 2. Web Application Setup (Next.js)

1. **Clone Repository & Install Dependencies:**
   ```bash
   git clone https://github.com/gitam/smartprint.git
   cd smartprint
   npm install
   ```

2. **Configure Environment Variables (`.env.local`):**
   ```env
   # Firebase Web Configuration
   NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyDB_GmIxOCJwBXdxnUZHApJc3NGXgr1nfs
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=gitam-smartprint.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=gitam-smartprint
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=gitam-smartprint.firebasestorage.app
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=245987999991
   NEXT_PUBLIC_FIREBASE_APP_ID=1:245987999991:web:fcd8085fc8d2b062c593f2

   # Supabase Database & Storage
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

   # Razorpay Payment Credentials
   RAZORPAY_KEY_ID=rzp_test_xxxxxx
   RAZORPAY_KEY_SECRET=your-razorpay-secret
   RAZORPAY_WEBHOOK_SECRET=your-webhook-secret
   ```

3. **Build & Launch Application:**
   ```bash
   npm run build
   npm run start
   ```

---

## 3. Raspberry Pi Installation

1. **Run Automated Installation Script:**
   ```bash
   cd raspberry-pi/scripts
   sudo bash install.sh
   ```

2. **Run USB HP Printer Detection & Multi-Printer CUPS Setup:**
   ```bash
   sudo bash printer_setup.sh
   ```

3. **Verify System Health:**
   ```bash
   sudo bash health_check.sh
   ```

4. **Start Systemd Background Services:**
   ```bash
   sudo systemctl start smartprint-agent.service
   sudo systemctl start smartprint-kiosk.service
   ```
