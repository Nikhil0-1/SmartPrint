#!/usr/bin/env python3
"""
Direct HTTP check of production deployment endpoints.
"""
import urllib.request
import urllib.error
import json

PROD_URL = "https://smart-prints.vercel.app"

def check_endpoint(name, url, method="GET", payload=None, headers=None):
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read().decode("utf-8")
            print(f"[{name}] HTTP {resp.status} - Content: {content[:150]}")
            return resp.status, content
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8") if e.fp else str(e)
        print(f"[{name}] HTTP {e.code} - Error: {err[:150]}")
        return e.code, err
    except Exception as e:
        print(f"[{name}] Failed: {e}")
        return 0, str(e)

if __name__ == "__main__":
    print("=" * 60)
    print("CHECKING LIVE PRODUCTION DEPLOYMENT AT " + PROD_URL)
    print("=" * 60)
    check_endpoint("Pricing API", f"{PROD_URL}/api/pricing?slug=gitam")
    check_endpoint("Branding API", f"{PROD_URL}/api/branding?slug=gitam")
    check_endpoint("Heartbeat (Missing Headers)", f"{PROD_URL}/api/kiosk/heartbeat", method="POST", payload={})
    check_endpoint("Download (Missing Headers)", f"{PROD_URL}/api/kiosk/download/SP-TEST", method="GET")
    check_endpoint("Poll Jobs (Missing Headers)", f"{PROD_URL}/api/kiosk/poll-jobs", method="POST", payload={})
    check_endpoint("Verify Payment (Missing Order)", f"{PROD_URL}/api/customer/verify-payment", method="POST", payload={})
    check_endpoint("Razorpay Webhook (Invalid Sig)", f"{PROD_URL}/api/webhooks/razorpay", method="POST", payload={"event":"test"}, headers={"x-razorpay-signature":"tampered"})
