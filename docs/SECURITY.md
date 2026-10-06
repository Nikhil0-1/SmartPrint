# GITAM SMARTPRINT - DOCUMENT SECURITY & EPHEMERAL PRIVACY

## 1. Zero-Retention Document Lifecycle

Customer document security is a primary architectural pillar of GITAM SMARTPRINT. Student documents are treated as strictly volatile, temporary data.

```
UPLOAD
   ↓
TEMPORARY PRIVATE MEMORY / STORAGE
   ↓
PAYMENT VERIFICATION
   ↓
ONE PRINT AUTHORIZATION (60-second signed URL)
   ↓
RASPBERRY PI TEMP DIRECTORY (/var/lib/smartprint/jobs/<id>)
   ↓
CUPS PRINTING (Physical output to USB HP printer)
   ↓
CUPS STATUS CONFIRMED (IPP_JOB_COMPLETED)
   ↓
LOCAL FILE SECURE WIPE (shred -u / binary zero overwrite)
   ↓
CLOUD MEMORY BUFFER PURGED
   ↓
DATABASE FILE STORAGE REFERENCE ERASED (storage_path = NULL)
   ↓
SYSTEM LOG: CLEANUP_VERIFIED
```

---

## 2. Security Safeguards

1. **No Public URLs**: Documents are never exposed to public internet URLs. Only authenticated Raspberry Pi devices receive short-lived (60s) authorized download access.
2. **Restricted File System Permissions**: Local print jobs on the Raspberry Pi reside in `/var/lib/smartprint/jobs/` with `chmod 700` and restricted ownership.
3. **Forensic File Destruction**: Before unlinking, file bytes are overwritten with zeros (`shred -u` or binary `0x00` overwrite) to prevent SD card forensic reconstruction.
4. **Boot-Time Cleanup**: At every boot or restart, `cleanup.sh` scans `/var/lib/smartprint/jobs/` and securely unlinks any lingering files from interrupted jobs.
5. **Audit Metadata Only**: After deletion, the database retains only non-sensitive operational metadata (Job ID, Kiosk ID, amount, timestamp, pages count, CUPS job ID).
6. **No Inbound Raspberry Pi Ports**: The Raspberry Pi operates entirely via outbound-only HTTPS requests, avoiding router port forwarding or public attack surfaces.
