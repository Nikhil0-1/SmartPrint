# RAZORPAY UPI & WEBHOOK INTEGRATION GUIDE

## 1. Overview
GITAM SMARTPRINT integrates Razorpay for frictionless UPI (Google Pay, PhonePe, Paytm, BHIM) and card payments.

---

## 2. Environment Configuration

Add the following variables in `.env.local` or cloud hosting environment:

```env
# Razorpay API Keys (Dashboard -> Settings -> API Keys)
RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=YYYYYYYYYYYYYYYYYYYYYYYY

# Webhook Secret (Dashboard -> Settings -> Webhooks)
RAZORPAY_WEBHOOK_SECRET=ZZZZZZZZZZZZZZZZZZZZZZZZ
```

---

## 3. Webhook Endpoint Setup

1. In Razorpay Dashboard, navigate to **Settings** → **Webhooks** → **Add New Webhook**.
2. Set Webhook URL:
   ```
   https://your-domain.com/api/webhooks/razorpay
   ```
3. Set Secret: Match `RAZORPAY_WEBHOOK_SECRET`.
4. Enable Events:
   - `order.paid`
   - `payment.captured`
   - `payment.failed`

---

## 4. Security & Idempotency Rules

1. **HMAC-SHA256 Signature Verification**: The backend validates the cryptographic signature of raw incoming webhook bodies:
   ```ts
   const expectedSignature = crypto
     .createHmac('sha256', secret)
     .update(rawBody)
     .digest('hex');
   ```
2. **Duplicate Protection**: The backend caches processed `event_id` values. Duplicate webhook deliveries are acknowledged with HTTP 200 without creating multiple prints.
3. **Never Blindly Print from Frontend Callback**: Payments must be verified server-side before the job state transitions to `PAYMENT_VERIFIED`.
