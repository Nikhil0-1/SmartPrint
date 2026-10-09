# USB HP Printer Setup & Driver Configuration Guide

## Overview
This document outlines physical hardware connection, USB device discovery (`lsusb`), driver selection (`hpcups`, `hplip`, `PCL`), and CUPS queue setup for HP Printers connected to a Raspberry Pi 3B+ kiosk.

---

## 1. Physical Hardware Connection
1. Connect the HP Printer USB Type-B cable to any open USB 2.0 port on the Raspberry Pi 3B+.
2. Power ON the HP printer and verify that paper is loaded in Tray 1 / Tray 2.
3. Verify USB bus identification using Linux command:
   ```bash
   lsusb | grep -i "Hewlett-Packard\|HP"
   ```
   *Expected Output Example:*
   `Bus 001 Device 004: ID 03f0:442a Hewlett-Packard HP LaserJet Pro M404dn`

---

## 2. Driver Installation & Package Selection
Run the package installer to ensure HP drivers are loaded:
```bash
sudo apt-get update
sudo apt-get install -y hplip printer-driver-hpcups cups cups-client
```

### Supported Driver Packages:
- **Primary Driver:** `printer-driver-hpcups` (Native HP CUPS Driver)
- **HPLIP Utility:** `hplip` (HP Linux Imaging and Printing)
- **Generic Fallback:** `drv:///sample.drv/generic.ppd` (Standard PCL/Postscript)

If automatic driver detection shows `MANUAL DRIVER REQUIRED`:
- Run `hp-setup -i` for interactive HPLIP driver installation.
- Or download vendor PPD file and install via `lpadmin -m /path/to/printer.ppd`.

---

## 3. Creating CUPS Print Queues
Register unique CUPS queues for each physical printer:

### B&W Primary Printer:
```bash
sudo lpadmin -p smartprint_bw_01 -E \
  -v "usb://HP/LaserJet%20Pro%20M404dn?serial=PH12345" \
  -m "hpcups:0/ppd/hplip/HP/hp-laserjet_pro_m404-m405.ppd" \
  -D "GITAM SmartPrint B&W Printer" \
  -L "Library Kiosk Main Tray"

sudo cupsenable smartprint_bw_01
sudo cupsaccept smartprint_bw_01
sudo lpoptions -p smartprint_bw_01 -o media=A4 -o ColorModel=K
```

### Color Primary Printer:
```bash
sudo lpadmin -p smartprint_color_01 -E \
  -v "usb://HP/Color%20LaserJet%20Pro%20M454dn?serial=PH67890" \
  -m "hpcups:0/ppd/hplip/HP/hp-color_laserjet_pro_m454.ppd" \
  -D "GITAM SmartPrint Color Printer" \
  -L "Library Kiosk Color Tray"

sudo cupsenable smartprint_color_01
sudo cupsaccept smartprint_color_01
sudo lpoptions -p smartprint_color_01 -o media=A4 -o ColorModel=Color
```

---

## 4. Maintenance Test Print
Trigger a physical test page on the target queue:
```bash
lp -d smartprint_bw_01 /usr/share/cups/data/testprint
```
Verify page output on the physical tray.
