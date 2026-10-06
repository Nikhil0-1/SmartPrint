# GITAM SMARTPRINT - PRODUCTION DEPLOYMENT GUIDE

## 1. Cloud Backend Deployment (Vercel / AWS / VPS)

### Option A: Vercel (Recommended for Next.js App Router)
1. Push repository to GitHub (`Nikhil0-1/Aviron`).
2. Import project into Vercel.
3. Configure Environment Variables:
   - `NEXT_PUBLIC_APP_URL`: Your production domain
   - `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon public key
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role secret
   - `RAZORPAY_KEY_ID`: Production Razorpay Key ID
   - `RAZORPAY_KEY_SECRET`: Production Razorpay Key Secret
   - `RAZORPAY_WEBHOOK_SECRET`: Production Webhook Secret

### Option B: Linux VPS / Docker (Node.js)
```bash
npm install
npm run build
npm start -p 3000
```

---

## 2. Supabase Database Migration
1. Open Supabase Dashboard → **SQL Editor**.
2. Run the migration script located at:
   `supabase/migrations/001_initial_schema.sql`
3. In **Storage**, create a private bucket named:
   `temporary-print-files`
   *(Ensure public read access is disabled)*.

---

## 3. Raspberry Pi Fleet Provisioning
For each kiosk hardware unit (e.g., `GITAM-SPK-001`, `GITAM-SPK-002`):
1. Install base OS and copy `raspberry-pi/` scripts.
2. Configure `/etc/smartprint/agent_config.json`:
   ```json
   {
     "backend_url": "https://your-production-domain.com",
     "kiosk_id": "GITAM-SPK-001",
     "device_token": "your-unique-kiosk-secret",
     "poll_interval_sec": 4,
     "heartbeat_interval_sec": 10
   }
   ```
3. Run `sudo bash install.sh`.
4. Connect the HP LaserJet printer via USB and test.
