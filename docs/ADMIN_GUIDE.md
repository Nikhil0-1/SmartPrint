# GITAM SMARTPRINT - ADMINISTRATOR GUIDE

## 1. Accessing the Admin Console
Navigate to [http://localhost:3000/admin](http://localhost:3000/admin) or your production domain `/admin`.

---

## 2. Managing Kiosks
- **Monitoring Health**: View CPU temperature, RAM usage, and disk space for every registered Raspberry Pi 3B+.
- **Maintenance Mode**: Toggle maintenance mode when reloading paper or performing printer repairs. The kiosk screen displays a user-friendly maintenance banner and stops accepting new print sessions.
- **Credential Rotation**: Rotate the device authentication token to invalidate stolen or compromised credentials.

---

## 3. Dynamic Branding
Navigate to **Branding Manager**:
- **Organization Name**: Default `GITAM`
- **Product Name**: Default `SMARTPRINT`
- **Primary Tagline**: Default `SCAN. UPLOAD. PAY. PRINT.`
- **Support Number**: Default `9006496970`
- **Powered By Credit**: Default `Nikhil`
- Updates apply immediately across the Mobile Web App, Kiosk HDMI Display, and Admin footer.

---

## 4. Pricing Engine
Navigate to **Pricing Engine**:
- Adjust Black & White rate (Default: ₹1.00/page)
- Adjust Color rate (Default: ₹5.00/page)
- Configure Service Charges, Max Pages, and File Size limits
- Changes are applied instantly to all server-side price calculations.

---

## 5. Audit & Security Verification
- Review the **Audit & Ephemeral File Cleanup Ledger** to confirm that every completed or expired job has a verified `CLEANUP_VERIFIED` record with zero lingering files on either the cloud or the Raspberry Pi.
