# Firebase Admin Auth & RBAC Setup Guide

## Overview
Administrative authentication in GITAM SMARTPRINT is secured via Firebase Authentication. Frontend credentials are used solely for user identification, while backend API routes verify Firebase tokens and enforce role-based access control (RBAC).

---

## 1. Firebase Configuration

### Frontend Web Config (`src/lib/firebase.ts`):
```typescript
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
```

---

## 2. Roles & Permissions

Admin roles are stored in the `admin_roles` database table:
- **SUPER_ADMIN:** Full access to Pricing Engine, Branding, Hardware Telemetry, Printer Routing, and Admin User management.
- **OPERATOR:** Access to Kiosk Status, Printer Queues, Test Print execution, and Audit Logs.

### Initial Super Admin User:
- **Email:** `admin@gitam.edu`
- **Role:** `SUPER_ADMIN`
- **Firebase UID:** `firebase_admin_super_001`
