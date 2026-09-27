# Sapp — Payment Gateway

A secure, multi-tenant payment gateway for **Guyana dollars (GYD)** card payments. Built with Cloudflare Workers, D1, and Hono.

**Sapp by Neuereatec Enterprise (Guyana)**

> **SANDBOX MODE** — This gateway is currently in test/development mode. No real payments are processed. For production deployment, the gateway is designed to integrate with an acquiring bank (planned: GBTI Bank, pending partnership agreement). There is no affiliation with or endorsement by any bank at this time.

## Features

- **Multi-tenant merchant accounts** with API key authentication
- **Hosted checkout page** — card data never touches merchant servers
- **Payment state machine** — authorize, capture, void, refund (full/partial)
- **Signed webhooks** with replay protection and retry delivery
- **Double-entry ledger** with settlement reports
- **Dispute/chargeback** management (mock)
- **3-D Secure** simulation for testing
- **Audit logging** for compliance
- **Rate limiting** and CORS protection

## Architecture

```
Merchant App/Website
   │  HTTPS API (Bearer token)
   ▼
Cloudflare Worker (Hono) ──► Workers D1 (orders, merchants, ledger)
   │                              │
   │ Signed webhooks              │ mirror (no card data)
   ▼                              ▼
Merchant webhook endpoint    Firebase Firestore (optional)
```

| Component | Role |
|-----------|------|
| **Cloudflare Workers** | API, hosted checkout, webhook delivery |
| **D1** | Orders, merchants, ledger, audit logs |
| **Firebase Firestore** | Optional real-time order status mirror |
| **GitHub Actions** | CI/CD deployment |

## Security

- **Card data isolation**: PAN/CVV/expiry entered only on hosted checkout, never stored
- **API authentication**: Per-merchant secret keys (sk_test_/sk_live_) with HMAC hashing
- **Webhook signatures**: Timestamped HMAC-SHA256 with replay protection
- **Security headers**: CSP, HSTS, X-Frame-Options, Referrer-Policy
- **Rate limiting**: Per-IP and per-merchant request limits
- **Audit trail**: All sensitive actions logged

## Quick Start

### 1. Deploy the Worker

```bash
cd workers
npm install --legacy-peer-deps
npx wrangler deploy
```

### 2. Set Required Secrets

```bash
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put MERCHANT_MASTER_KEY
# Optional: Firebase mirror
npx wrangler secret put FIREBASE_PROJECT_ID
npx wrangler secret put FIREBASE_CLIENT_EMAIL
npx wrangler secret put FIREBASE_PRIVATE_KEY
```

### 3. Create a Merchant Account (admin only)

Merchant onboarding is an **admin action**: it requires the gateway's
`MERCHANT_MASTER_KEY` as a bearer token. Unauthenticated requests get `401`,
wrong keys get `403`, and if `MERCHANT_MASTER_KEY` is not configured the
endpoint fails closed with `503`.

```bash
curl -X POST https://sapp-gateway.neuereatec.workers.dev/v1/merchants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MERCHANT_MASTER_KEY" \
  -d '{"name": "My Store", "email": "merchant@example.com"}'
```

The response contains a **test key only** (`testApiKey`, `sk_test_...`) — save it,
it won't be shown again. No live key is issued at signup.

Live keys (`sk_live_...`) are issued only by an admin, and only after the merchant is approved:

```bash
# Approve the merchant (admin)
curl -X POST https://sapp-gateway.neuereatec.workers.dev/v1/admin/merchants/MERCHANT_ID/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MERCHANT_MASTER_KEY" \
  -d '{"status": "approved"}'

# Issue (or rotate) the live key (admin)
curl -X POST https://sapp-gateway.neuereatec.workers.dev/v1/admin/merchants/MERCHANT_ID/live-key \
  -H "Authorization: Bearer $MERCHANT_MASTER_KEY"
```

### 4. Create an Order

```bash
curl -X POST https://sapp-gateway.neuereatec.workers.dev/v1/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk_test_..." \
  -H "Idempotency-Key: unique-request-id" \
  -d '{"amountCents": 150000, "currency": "GYD", "description": "Demo order"}'
```

### 5. Get Checkout URL

```bash
curl -X POST https://sapp-gateway.neuereatec.workers.dev/v1/orders/ORDER_ID/pay \
  -H "Authorization: Bearer sk_test_..."
```

Redirect the customer to the `checkoutUrl` returned.

## Test Cards

| Card Number | Result |
|-------------|--------|
| `4111 1111 1111 1111` | Success (captured) |
| `4000 0000 0000 0002` | Declined |
| `4000 0000 0000 0010` | Insufficient funds |
| `4000 0000 0000 0028` | Expired card |
| `4000 0000 0000 3220` | 3DS challenge required (sandbox OTP `123456`) |
| `5555 5555 5555 4444` | Success (Mastercard) |

**Important:** Only documented test cards are accepted. All other card numbers (even valid Luhn) are declined with `use_test_card` error.

### 3-D Secure (sandbox)

Card `4000 0000 0000 3220` requires a 3-D Secure challenge:

1. `POST /mock-processor/charge` returns `status: "3ds_required"` with a server-issued `challengeId`
   and a `redirectUrl` to `/3ds-challenge/<challengeId>`. The order stays `pending` with
   `threeDsStatus: "challenge_required"`.
2. The customer enters the one-time code on the challenge page. **The sandbox OTP is `123456`.**
   Any other code is rejected.
3. The page posts `challengeId` + `code` to `POST /3ds-complete`. The order is captured only if the
   challenge is still pending, has not expired, belongs to that order, the order is still awaiting 3DS,
   and the code is correct.

Rules:
- Challenges expire after **10 minutes**. Completing an expired challenge fails the payment (`410`).
- **3 attempts** per challenge. After 3 wrong codes the challenge and the payment fail.
- Challenges are **single-use**. Reusing a completed or closed challenge returns `409`.
- Starting a new 3DS charge on the same order supersedes any earlier pending challenge.
- `/3ds-complete` without a valid server-issued challenge id returns `400` and never changes the order.

JSON clients can send `Accept: application/json` to get JSON responses instead of redirects.

## API Reference

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/merchants` | Create merchant account (**admin**: `Bearer MERCHANT_MASTER_KEY`; returns `sk_test_` key only) |
| `POST` | `/v1/admin/merchants/:id/status` | Set merchant status `pending`/`approved`/`suspended` (**admin**) |
| `POST` | `/v1/admin/merchants/:id/live-key` | Issue/rotate an `sk_live_` key for an approved merchant (**admin**) |
| `GET` | `/v1/merchants/me` | Get current merchant info |
| `POST` | `/v1/orders` | Create order |
| `GET` | `/v1/orders` | List merchant's orders |
| `GET` | `/v1/orders/:id` | Get order details |
| `POST` | `/v1/orders/:id/pay` | Get checkout URL |
| `POST` | `/v1/orders/:id/capture` | Capture authorized payment |
| `POST` | `/v1/orders/:id/refund` | Refund captured payment |
| `POST` | `/v1/orders/:id/void` | Void authorization |
| `GET` | `/v1/webhooks/events` | List webhook events |
| `GET` | `/v1/ledger` | Get ledger entries |
| `GET` | `/v1/settlements` | List settlement reports |
| `GET` | `/v1/disputes` | List disputes |
| `GET` | `/v1/test-cards` | List test card numbers |

### Authentication

Include your API key in the Authorization header:

```
Authorization: Bearer sk_test_xxxx
```

Test keys (`sk_test_`) work in sandbox mode and are the only keys issued at signup.
Live keys (`sk_live_`) are issued only through the admin live-key endpoint, for approved merchants.

### Idempotency

Include an `Idempotency-Key` header on POST requests to prevent duplicate operations:

```
Idempotency-Key: unique-request-identifier
```

Keys are valid for 24 hours.

### Webhook Signature Verification

Webhooks are signed with your merchant's webhook secret:

```
X-Sapp-Signature: t=1234567890,v1=abc123...
```

Verify using:

```javascript
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const [tPart, v1Part] = signature.split(',');
  const timestamp = tPart.split('=')[1];
  const expectedSig = v1Part.split('=')[1];
  
  // Check timestamp within 5 minutes
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > 300) return false;
  
  const signedPayload = `${timestamp}.${payload}`;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(expectedSig));
}
```

## Android App

The Android app package is `com.neuereatec.sapp`.

To build:

```bash
cd app
./gradlew assembleCloudDebug
```

**Note:** The app opens the checkout in Chrome Custom Tabs (not WebView) for security.

## Running Tests

```bash
cd workers
npm test
```

## Manual Steps Required (Owner)

After merging this PR, you must:

1. **Rename GitHub repository** from `gbti-payment-gateway` to `sapp-gateway`
2. **Delete the v1.0.0-cloud-debug release** and the "GBTI Pay" APK
3. **Create a new Firebase project** named `sapp-gateway` (project IDs cannot be renamed)
4. **Update GitHub Actions secrets** for the new Worker name
5. **Update the Worker URL** in any integrations
6. **Renew business registration** B35276 before approaching banks

## Go Live Checklist

Before processing real payments:

1. [ ] Partnership agreement with acquiring bank
2. [ ] Production MID and credentials from bank
3. [ ] Replace mock processor with bank's hosted checkout/API
4. [ ] PCI DSS compliance (SAQ or QSA assessment)
5. [ ] BoG PSP license (if operating as payment facilitator)
6. [ ] SSL certificate for custom domain
7. [ ] Production Firebase project
8. [ ] Rate limits tuned for expected volume
9. [ ] Monitoring and alerting configured
10. [ ] Incident response plan documented

## License

Proprietary — All rights reserved.
Sapp by Neuereatec Enterprise (Guyana)

See [LICENSE](LICENSE) for details.
