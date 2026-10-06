# RASPBERRY PI 3B+ INSTALLATION & DEPLOYMENT GUIDE

## 1. Hardware Requirements
- **Board**: Raspberry Pi 3 Model B+ (1GB RAM)
- **Power**: 5V / 2.5A micro-USB power supply
- **Storage**: Class 10 MicroSD Card (16GB or 32GB)
- **Display**: Desktop HDMI Monitor (1080p, 60Hz) + standard HDMI cable
- **Printer Connection**: High-Speed USB 2.0 A-to-B cable to HP LaserJet Printer
- **Network**: 2.4GHz Wi-Fi or 100Mbps Ethernet

---

## 2. OS Setup & Base Configuration

1. Use **Raspberry Pi Imager** to install **Raspberry Pi OS (64-bit or 32-bit with desktop)**.
2. In Advanced Options, configure:
   - Hostname: `gitam-smartprint-01`
   - Username: `pi`
   - Wi-Fi credentials (or connect Ethernet)
   - Enable SSH (for internal maintenance only)
3. Boot Raspberry Pi, open terminal, and run:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

---

## 3. Automated SmartPrint Installation

Copy the repository to `/opt/smartprint` or clone directly:
```bash
sudo git clone https://github.com/Nikhil0-1/Aviron.git /opt/smartprint
sudo bash /opt/smartprint/raspberry-pi/scripts/install.sh
```

The script automatically:
- Installs `cups`, `hplip`, `python3-cups`, and `chromium-browser`
- Configures lpadmin group privileges
- Restricts permissions on `/var/lib/smartprint/jobs` to `chmod 700`
- Installs Python dependencies
- Registers `smartprint-agent.service` and `smartprint-kiosk.service` in systemd

---

## 4. Hardware Verification

Run the built-in diagnostic utility:
```bash
sudo bash /opt/smartprint/raspberry-pi/scripts/health_check.sh
```

Expected output:
```
  [ PASS ] Internet Connectivity: Public DNS reachable (8.8.8.8)
  [ PASS ] Cloud Backend API: Connected to Backend (HTTP 200)
  [ PASS ] USB HP Printer Detection: Hewlett-Packard HP LaserJet
  [ PASS ] CUPS Printing Daemon: cups.service active and running
  [ PASS ] Printer Queue (HP_LaserJet_USB): HP_LaserJet_USB ready
  [ PASS ] Disk Storage (/var/lib): 14200 MB available
  [ PASS ] Document Security Permissions: /var/lib/smartprint/jobs is chmod 700
  [ PASS ] NTP Time Sync: System clock synchronized
SYSTEM OPERATIONAL - KIOSK READY
```

---

## 5. Starting Kiosk Services

Enable and start systemd units:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now smartprint-agent.service
sudo systemctl enable --now smartprint-kiosk.service
```

To view live agent logs:
```bash
journalctl -u smartprint-agent.service -f
```
