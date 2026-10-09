# Razorpay Webhook & Idempotency Specification

## Overview
The Razorpay Webhook endpoint (`/api/webhooks/razorpay`) processes asynchronous payment confirmations from Razorpay servers.

---

## 1. Security & Signature Verification
Every incoming webhook request is validated against `RAZORPAY_WEBHOOK_SECRET` using HMAC-SHA256:
```typescript
const expectedSignature = crypto
  .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
  .update(rawBody)
  .digest('hex');
```
Requests failing signature verification return `400 Bad Request` and are discarded.

---

## 2. Webhook Rules & Idempotency
- **Event ID Cache:** Duplicate webhook event IDs are detected and safely acknowledged with `{ status: 'ignored_duplicate' }` without re-processing.
- **No Direct Hardware Control:** Webhooks **NEVER** issue direct commands to printers. They only update database state to `PAYMENT_VERIFIED` and authorize single-use job execution.
- **Idempotency Key:** Each job contains a unique `idempotency_key` ensuring a transaction authorizes exactly **one** print attempt.
