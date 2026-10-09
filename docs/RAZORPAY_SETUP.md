# Razorpay Payment Integration Guide

## Overview
GITAM SMARTPRINT integrates Razorpay for cashless campus UPI payments (Google Pay, PhonePe, Paytm, BHIM).

---

## 1. Environment Variables
Add Razorpay API keys to `.env.local`:
```env
RAZORPAY_KEY_ID=rzp_test_xxxxxx
RAZORPAY_KEY_SECRET=your-razorpay-secret
RAZORPAY_WEBHOOK_SECRET=your-webhook-secret
```

---

## 2. Server-Side Price Calculation
- **Black & White:** ₹1.00 / page
- **Color:** ₹5.00 / page
- **Calculation Formula:** `Total = (pages_selected × copies × rate) + service_charge`
- **Server Enforcement:** Client-supplied prices are strictly ignored. Price is computed on backend only.

---

## 3. Payment Flow & Safety
1. Customer configures job on mobile web app.
2. Server validates printer availability before order creation.
3. Server calls Razorpay `/v1/orders` API and returns `order_id`.
4. Customer completes UPI payment.
5. Webhook verifies HMAC-SHA256 signature and updates job to `PAYMENT_VERIFIED`.
