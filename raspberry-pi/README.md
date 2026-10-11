# GITAM SMARTPRINT — Raspberry Pi 3B+ Deployment & Hardware Guide

This directory contains the production software agent, installation scripts, CUPS print controller, and systemd units for deploying GITAM SMARTPRINT on a Raspberry Pi 3B+ controller connected to a physical printer and an HDMI monitor.

---

## 1. Hardware Architecture

```
+-----------------------------------------------------------------------------------+
|                            RASPBERRY PI 3B+ CONTROLLER                            |
|                                                                                   |
|  [Power Supply: 5V 2.5A Micro-USB / USB-C with stable surge protection]           |
|                                                                                   |
|  +--------------------+        +--------------------+        +-----------------+  |
|  |     HDMI Port      |        |     USB Port 1     |        |   Ethernet/WiFi |  |
|  +---------+----------+        +---------+----------+        +--------+--------+  |
+------------|-----------------------------|----------------------------|-----------+
             |                             |                            |
             v                             v                            v
  +--------------------+        +--------------------+        +-----------------+
  | Desktop HDMI       |        | HP/Canon Printer   |        | Cloud Backend   |
  | Kiosk Monitor      |        | USB Direct Cable   |        | Outbound HTTPS  |
  | (Full-screen Light |        | (CUPS Queue:       |        | (Supabase &     |
  |  State Machine)    |        |  HP_LaserJet_USB)  |        |  Next.js API)   |
  +--------------------+        +--------------------+        +-----------------+
```

### Physical Components:
- **Single Board Computer**: Raspberry Pi 3B+ (ARMv7 / aarch64, 1GB LPDDR2 SDRAM)
- **Display**: Desktop HDMI Monitor (1080p / 720p), configured in fullscreen portrait or landscape kiosk mode (`cage` or Chromium kiosk mode)
- **Printer**: USB HP / Canon Laser Printer (e.g. HP LaserJet Pro M12a / M126nw / 1020 / P1102 or IPP Everywhere compatible printer)
- **Network**: Outbound HTTPS (443) only. No inbound public ports or port-forwarding required.
- **Power**: Official Raspberry Pi 5V 2.5A power adapter (prevents under-voltage printer stall during warm-up).

---

## 2. Directory Structure

```
raspberry-pi/
├── README.md                      # This deployment guide
├── requirements.txt               # Python dependencies (pycups, requests)
├── agent/
│   ├── cups_controller.py         # CUPS queue controller & printer discovery
│   └── smartprint_agent.py        # Production IoT agent, heartbeat & job spooler
├── scripts/
│   ├── install.sh                 # Master installer for Raspberry Pi OS
│   ├── preflight_check.sh         # Validates CPU, RAM, disk, OS, and USB bus
│   ├── detect_os.sh               # Raspberry Pi OS version detection
│   ├── detect_printers.sh         # Detects connected USB/Network printers
│   ├── setup_cups.sh              # Installs & configures Linux CUPS server
│   ├── printer_setup.sh           # Configures printer queue and driver
│   ├── register_device.sh         # Enrolls device token with cloud backend
│   ├── setup_agent.sh             # Sets up Python virtualenv and system agent
│   ├── kiosk_setup.sh             # Sets up fullscreen Wayland/X11 kiosk mode
│   ├── setup_services.sh          # Installs and enables systemd service units
│   ├── health_check.sh            # Runs full hardware diagnostics
│   ├── cleanup_temp.sh            # Shreds lingering temporary files
│   ├── update_agent.sh            # Safe in-place agent update
│   ├── rollback_agent.sh          # Reverts agent to previous backup
│   └── uninstall.sh               # Clean removal of smartprint services
└── systemd/
    ├── smartprint-agent.service   # Agent background daemon
    ├── smartprint-kiosk.service   # Fullscreen browser kiosk service
    ├── smartprint-health.service  # Periodic health check unit
    ├── smartprint-health.timer    # Health check timer (every 10m)
    ├── smartprint-cleanup.service # Ephemeral file cleanup unit
    └── smartprint-cleanup.timer   # Cleanup timer (every 15m)
```

---

## 3. Installation Steps

### Step 1: Flash Raspberry Pi OS
Install **Raspberry Pi OS Lite (64-bit or 32-bit, Bookworm / Bullseye)** onto a high-end Class 10 MicroSD card (16GB+).

### Step 2: Clone Repository
```bash
sudo apt-get update && sudo apt-get install -y git curl
git clone https://github.com/Nikhil0-1/SmartPrint.git /opt/smartprint
cd /opt/smartprint/raspberry-pi
```

### Step 3: Run Preflight Check
```bash
sudo bash scripts/preflight_check.sh
```

### Step 4: Run Automated Installation
```bash
sudo bash scripts/install.sh \
  --backend-url "https://smartprint.gitam.edu" \
  --kiosk-id "GITAM-SPK-001" \
  --device-token "gitam_spk_001_secure_device_secret_2026"
```

The installer will:
1. Verify operating system and architecture (`armv7l` or `aarch64`).
2. Install CUPS, `libcups2-dev`, `python3-pip`, `printer-driver-hpijs`, `hplip`.
3. Configure CUPS daemon and authorize `lp` group.
4. Auto-detect connected USB printer and configure CUPS queue.
5. Setup the Python agent in `/var/lib/smartprint`.
6. Configure fullscreen kiosk display pointing to `/kiosk/GITAM-SPK-001`.
7. Install, enable, and start systemd units:
   - `smartprint-agent.service`
   - `smartprint-kiosk.service`
   - `smartprint-cleanup.timer`
   - `smartprint-health.timer`

---

## 4. Operational Commands

### Check Agent Logs
```bash
sudo journalctl -u smartprint-agent.service -f
```

### Check CUPS Printer Status
```bash
lpstat -t
lpstat -p HP_LaserJet_USB
```

### Run Hardware Diagnostic
```bash
sudo bash scripts/health_check.sh
```

### Trigger Test Print
```bash
lp -d HP_LaserJet_USB /usr/share/cups/data/testprint
```

### Restart Agent Service
```bash
sudo systemctl restart smartprint-agent.service
```

---

## 5. Security & Zero-Retention Policy

- **Outbound Only**: The Raspberry Pi opens no inbound listening ports to the Internet.
- **Device Authentication**: Authenticates with cloud API via SHA-256 hashed device tokens in `x-device-token` headers.
- **Ephemeral Spooling**: Customer PDF documents are spooled to `/var/lib/smartprint/jobs/<jobId>.pdf`. Upon successful CUPS completion, the agent executes `shred -u` to overwrite and delete the file immediately.
- **Idempotency Guard**: Local SQLite database at `/var/lib/smartprint/agent_state.db` guarantees that no job is printed more than once, even across reboots or network interruptions.
