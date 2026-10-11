# Organization-Specific Razorpay Integration & Webhook Verification

## 1. Overview & Security Model

Each organization within GITAM SMARTPRINT configures its own Razorpay payment gateway credentials. Secrets are stored securely in `payment_configurations` and are **never exposed to frontend clients**.

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Customer (Mobile Phone)
    participant Backend as Backend Pricing Engine
    participant DB as PostgreSQL (payment_configurations)
    participant Razorpay as Razorpay API
    participant WebhookHandler as /api/webhooks/razorpay

    Customer->>Backend: Request checkout for Job SP-xxxx
    Backend->>Backend: Calculate billable pages × price in integer paise
    Backend->>DB: Fetch Organization's Razorpay Key ID & Key Secret
    Backend->>Razorpay: POST /v1/orders (amount: integer paise, currency: 'INR', notes: { org_id, job_id })
    Razorpay-->>Backend: Return order_id (e.g. order_mv3eu5ys...)
    Backend-->>Customer: Return order_id & public razorpay_key_id (Secret NEVER returned)

    Customer->>Razorpay: Completes payment on phone (UPI / Card)
    Razorpay->>WebhookHandler: POST raw body + Header x-razorpay-signature
    WebhookHandler->>DB: Check webhook_events table for event_id (Idempotency)
    alt Duplicate event detected
        WebhookHandler-->>Razorpay: HTTP 200 { status: 'ignored_duplicate' }
    else New unique event
        WebhookHandler->>WebhookHandler: HMAC-SHA256(raw_body, org_webhook_secret)
        alt Signature matches
            WebhookHandler->>DB: Record payment_transactions & Authorize EXACTLY ONE print operation
            WebhookHandler-->>Razorpay: HTTP 200 { status: 'ok' }
        else Signature mismatch
            WebhookHandler-->>Razorpay: HTTP 400 { error: 'Invalid webhook signature' }
        end
    end
```

---

## 2. Integer Paise Precision Guarantee

To prevent rounding errors and currency discrepancy attacks:
- All financial calculations are computed and recorded in **integer paise** ($1 \text{ INR} = 100 \text{ paise}$).
- Default B&W rate: `100 paise` ($₹1.00$).
- Default Colour rate: `500 paise` ($₹5.00$).
- Floating-point arithmetic is never used for currency storage or gateway submission.

---

## 3. Webhook Idempotency

Razorpay webhooks can be retried multiple times. Idempotency is enforced through the `webhook_events` table:
```sql
CREATE TABLE IF NOT EXISTS webhook_events (
    id VARCHAR(128) PRIMARY KEY, -- event_id from Razorpay payload
    organization_id UUID REFERENCES organizations(id),
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```
Duplicate events with the same `event_id` are safely acknowledged without creating duplicate authorizations.
