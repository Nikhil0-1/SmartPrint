# Firebase Authentication & Administrative Authorization

## 1. Overview

Administrative access to GITAM SMARTPRINT is authenticated via **Firebase Authentication** and independently authorized by the trusted backend against database organization memberships.

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Super Admin / Org Admin
    participant Frontend as Admin Console (/admin)
    participant Firebase as Firebase Auth Service
    participant Backend as Next.js API (/api/admin/*)
    participant DB as PostgreSQL (organization_members)

    Admin->>Frontend: Enters Email & Password
    Frontend->>Firebase: signInWithEmailAndPassword()
    Firebase-->>Frontend: Returns Firebase User & ID Token (JWT)
    Frontend->>Backend: API Request with Header: Authorization: Bearer <ID_TOKEN>
    
    Backend->>Backend: verifyFirebaseIdToken(token)
    Backend->>Backend: Verify token signature, issuer, audience & expiry
    Backend->>DB: Query organization_members by email / firebase_uid
    
    alt User is Platform Super Admin (admin@gitam.edu or role=SUPER_ADMIN)
        Backend-->>Frontend: Authorized for ALL Organizations
    else User is Organization Admin
        Backend-->>Frontend: Authorized ONLY for assigned organization_id
    else Unregistered or Expired
        Backend-->>Frontend: HTTP 401 / 403 Access Denied
    end
```

---

## 2. Super Admin Permissions vs Organization Admin Permissions

| Operation | Platform Super Admin | Organization Admin |
| :--- | :---: | :---: |
| Create New Organization | ✓ | ✗ |
| View All Organizations | ✓ | ✗ |
| Manage Platform Global Policies | ✓ | ✗ |
| Register Raspberry Pi Hardware | ✓ | Scoped to Org |
| Configure Razorpay Credentials | ✓ | Scoped to Org |
| Manage Organization Pricing | ✓ | Scoped to Org |
| View Organization Print Jobs | ✓ | Scoped to Org |
| View Organization Audit Logs | ✓ | Scoped to Org |

---

## 3. Trusted Initial Provisioning

1. The platform initializes `admin@gitam.edu` as the foundational Super Admin in `003_multi_tenant_architecture.sql`.
2. New organization administrators are invited by the Super Admin via `/api/admin/organizations/[orgId]/members`, generating a database invitation with assigned organization binding.
3. Client-side variables such as `isSuperAdmin = true` are **never trusted**. Every privileged API route verifies the user's role on the server.
