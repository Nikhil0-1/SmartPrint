# Multi-Tenant Architecture & Tenant Isolation

## 1. Multi-Tenant Model

GITAM SMARTPRINT employs a shared-application, multi-tenant database model. Multiple university campuses and independent commercial print shops operate securely within the same deployment.

```mermaid
graph TD
    subgraph PlatformLayer["Platform Layer"]
        PSA[Platform Super Admin]
    end

    subgraph OrgA["Tenant A: GITAM SMARTPRINT"]
        OA_A[GITAM Org Admin]
        Loc_A[GITAM Central Library]
        Kiosk_A[GITAM-SPK-001]
        RPi_A[Raspberry Pi 3B+ A]
        Pay_A[Razorpay Key: rzp_live_gitam...]
        Jobs_A[GITAM Print Jobs]
    end

    subgraph OrgB["Tenant B: APNA SMART PRINTER"]
        OA_B[Apna Org Admin]
        Loc_B[Apna Market Pavilion]
        Kiosk_B[APNA-SPK-001]
        RPi_B[Raspberry Pi 3B+ B]
        Pay_B[Razorpay Key: rzp_live_apna...]
        Jobs_B[Apna Print Jobs]
    end

    PSA --> OrgA
    PSA --> OrgB
    OA_A --> Loc_A --> Kiosk_A --> RPi_A --> Jobs_A
    OA_A -.-> Pay_A
    OA_B --> Loc_B --> Kiosk_B --> RPi_B --> Jobs_B
    OA_B -.-> Pay_B

    OA_A -.->|STRICTLY FORBIDDEN (403)| OrgB
    OA_B -.->|STRICTLY FORBIDDEN (403)| OrgA
```

---

## 2. Strict Tenant Isolation Rules

1. **Database-Level Foreign Keys & RLS**:
   Every tenant entity (`locations`, `kiosks`, `devices`, `printers`, `branding`, `pricing`, `sessions`, `print_jobs`, `payment_configurations`, `cleanup_jobs`) possesses an immutable `organization_id UUID` foreign key pointing to `organizations(id)`.
2. **Authorization Enforcement**:
   - `SUPER_ADMIN`: Can manage all organizations, onboard new institutions, register kiosks, and view global audit logs.
   - `ORG_ADMIN`: Scoped strictly to their designated `organization_id`. Any attempt to read, update, or delete records of another organization is rejected with **HTTP 403 Forbidden**.
3. **Storage Path Scoping**:
   All files uploaded to Supabase Storage use canonical tenant prefixes:
   `smartprint-temporary/{organizationId}/{sessionId}/{documentId}_{cleanFilename}`
4. **Independent Razorpay Credentials**:
   Each organization configures its own `razorpay_key_id`, `razorpay_key_secret`, and `webhook_secret`. Funds flow directly into the respective organization’s merchant account.
