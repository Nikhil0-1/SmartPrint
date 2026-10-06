# CUPS & HP USB PRINTER CONFIGURATION GUIDE

## 1. Overview
GITAM SMARTPRINT uses standard Common Unix Printing System (CUPS) with Linux HPLIP (HP Linux Imaging and Printing) drivers for local document rasterization and USB transport to HP LaserJet printers.

---

## 2. Detecting the USB Connection

1. Connect the HP LaserJet printer to one of the 4 USB ports on Raspberry Pi 3B+.
2. Power on the printer.
3. Check the Linux USB bus:
   ```bash
   lsusb | grep -i "Hewlett-Packard\|HP"
   ```
   Example output:
   ```
   Bus 001 Device 004: ID 03f0:002a HP, Inc LaserJet 1020
   ```

---

## 3. Automated Setup Script

Run the automated discovery script:
```bash
sudo bash /opt/smartprint/raspberry-pi/scripts/printer_setup.sh
```

---

## 4. Manual Configuration (Fallback)

If configuring manually via CUPS CLI:

### 1. Identify Printer Device URI
```bash
lpinfo -v | grep usb
```
Output:
```
direct usb://HP/LaserJet%20Pro%20M404dn?serial=PHB4920
```

### 2. Add Queue
```bash
lpadmin -p HP_LaserJet_USB -E -v "usb://HP/LaserJet%20Pro%20M404dn?serial=PHB4920" -m drv:///sample.drv/generic.ppd -D "GITAM SmartPrint USB HP Printer"
```

### 3. Enable Queue and Set Default
```bash
cupsenable HP_LaserJet_USB
cupsaccept HP_LaserJet_USB
lpadmin -d HP_LaserJet_USB
lpoptions -p HP_LaserJet_USB -o media=A4
```

### 4. Send Test Print
```bash
lp -d HP_LaserJet_USB /usr/share/cups/data/testprint
```

### 5. Check Queue Status
```bash
lpstat -p HP_LaserJet_USB
lpstat -o HP_LaserJet_USB
```
