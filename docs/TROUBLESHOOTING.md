# GITAM SMARTPRINT - HARDWARE & SYSTEM TROUBLESHOOTING GUIDE

## 1. Quick Diagnostic Flowchart

```
Hardware Issue Detected
   │
   ├── Run Health Check: sudo bash /opt/smartprint/raspberry-pi/scripts/health_check.sh
   │
   ├── If Printer Offline:
   │     1. Check USB cable connection (both ends)
   │     2. Verify printer power switch is ON
   │     3. Run: lsusb | grep -i HP
   │     4. Run: sudo bash /opt/smartprint/raspberry-pi/scripts/printer_setup.sh
   │
   ├── If Kiosk Screen Blank:
   │     1. Verify HDMI cable to desktop monitor
   │     2. Check service: sudo systemctl status smartprint-kiosk.service
   │     3. Restart kiosk: sudo systemctl restart smartprint-kiosk.service
   │
   └── If Agent Not Polling Jobs:
         1. Check internet: ping -c 3 8.8.8.8
         2. Check agent logs: journalctl -u smartprint-agent.service -f
         3. Verify backend URL in /etc/smartprint/agent_config.json
```

---

## 2. Common Issues & Solutions

### A. "Printer offline / Queue stopped"
**Cause**: Printer ran out of paper or experienced a paper jam, causing CUPS to disable the queue.  
**Solution**:
Refill paper, clear jam, and re-enable queue:
```bash
cupsenable HP_LaserJet_USB
cupsaccept HP_LaserJet_USB
```

### B. "Duplicate print prevention triggered"
**Cause**: An already processed Job ID was re-submitted during a network reconnect.  
**Solution**:
This is expected idempotent behavior. The local agent state database (`/var/lib/smartprint/agent_state.db`) prevents duplicate physical printing. No action required.

### C. "Customer sees: Printing is temporarily unavailable"
**Cause**: The kiosk is in maintenance mode or printer is disconnected.  
**Solution**:
Check the Admin Console `/admin` under **Printer Hardware** for the exact status.
