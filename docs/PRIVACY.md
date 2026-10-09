# Zero-Retention File Privacy & Destruction Policy

## Overview
GITAM SMARTPRINT enforces a strict **Zero-Retention File Privacy Architecture**. Customer documents are treated as transient payloads and are destroyed immediately post-print.

---

## 1. Document Lifecycle & Destruction Sequence

```
1. Customer Uploads Document
   ▼
2. Saved in Private Storage (`print-temp` bucket / temporary RAM buffer)
   ▼
3. Payment Verified & Authorized
   ▼
4. Raspberry Pi Downloads File to /var/lib/smartprint/jobs/<jobId>/
   ▼
5. File Submitted to CUPS Queue
   ▼
6. HP Printer Outputs Pages
   ▼
7. CUPS Confirms Verified Completion
   ▼
8. Immediate Local Destruction (`shred -u` / 0x00 Overwrite)
   ▼
9. Immediate Cloud Storage Destruction (`print-temp` bucket remove)
   ▼
10. Database File Path Nullified & Status Set to `DELETED`
```

---

## 2. Security Safeguards
- **No File Logging:** Document contents, file URLs, and signed download URLs are never logged in system telemetry.
- **Access Control:** Storage bucket `print-temp` is strictly private (`Public = false`).
- **Emergency Lifespan:** Any failed or unprinted job payload is automatically purged after a maximum 24-hour window.
