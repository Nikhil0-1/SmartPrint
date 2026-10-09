# HP Printer & CUPS Hardware Troubleshooting Guide

## Overview
Diagnostic guide for resolving USB hardware, CUPS queue errors, paper jams, and printer offline conditions on Raspberry Pi 3B+ kiosks.

---

## 1. Quick Diagnostics CLI Checklist

### Check USB Connectivity:
```bash
lsusb | grep -i "HP\|Printer"
```
*If empty:* Re-seat USB cable, verify printer power, or try another Pi USB port.

### Check CUPS Daemon Status:
```bash
sudo systemctl status cups
```
*If stopped:* `sudo systemctl restart cups`

### Check Active CUPS Queues:
```bash
lpstat -p
lpstat -o
```

---

## 2. Common Faults & Remediation

| Symptom | Cause | Resolution |
| --- | --- | --- |
| `Queue 'smartprint_bw_01' not found` | CUPS queue deleted or uninitialized | Run `sudo bash printer_setup.sh` |
| `Printer paused / stopped` | Paper jam or out-of-paper error | Clear physical tray, then run `cupsenable smartprint_bw_01` |
| `Color printing unavailable` | Color printer offline | Check USB cable for Color printer or enable Backup Route in Admin Panel |
| `Local disk full (>92%)` | Stale temporary files | Run `sudo bash cleanup.sh` |
| `MANUAL DRIVER REQUIRED` | PPD not found for printer model | Run `hp-setup -i` or install `printer-driver-hpcups` |

---

## 3. Support Hotline
- **GITAM Kiosk Support:** `9006496970`
- **Lead Developer:** Nikhil
