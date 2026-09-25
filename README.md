# GBTI Bank — Sandbox Payment Gateway

Demo merchant checkout for **Guyana dollars (GYD)** with Visa/Mastercard via a **hosted mock checkout**. Branded for GBTI Bank (sandbox only).

**Website:** [How to use the app, API, and build the APK](https://bbscalton.github.io/gbti-payment-gateway/)  
Also mirrored from the Worker at [`/docs`](https://gbti-payment-gateway.neuereatec.workers.dev/docs).

> **Not production.** Mock/sandbox only. Never store PAN/CVV/expiry in the app, GitHub, KV, or Firestore.

## Three-piece architecture

```
Android (Compose)
   │  HTTPS API
   ▼
Cloudflare Worker (Hono) ──► Workers D1 (orders)
   │                              │
   │ HMAC webhook (paid/failed)   │ mirror (no card data)
   ▼                              ▼
Hosted checkout HTML         Firebase Firestore
                             (orders/{id} status)
```

| Piece | Role |
|-------|------|
| **GitHub** | Source of truth + Actions deploy Worker on push to `main` |
| **Cloudflare Workers** | Public HTTPS API, hosted checkout, mock processor, HMAC webhooks, **D1** order store |
| **Firebase Firestore** | Optional realtime order-status mirror for the Android receipt screen |

### Security rules enforced

- Android and merchant APIs **never** collect, transmit, or store raw card numbers, expiry, or CVV.
- Card entry happens only on the **hosted checkout** page → **mock processor**.
- Orders become `paid` **only** after an **HMAC-signed webhook** is verified.
- Firestore stores only: `id`, `amountCents`, `currency`, `status`, `paymentRef`, `description`, timestamps.

## Live endpoints (this deployment)

| Resource | Value |
|----------|-------|
| Docs site | https://bbscalton.github.io/gbti-payment-gateway/ |
| Worker | `https://gbti-payment-gateway.neuereatec.workers.dev` |
| Worker docs redirect | `GET /docs` |
| Firebase project | `gbti-payment-gateway` |
| Health | `GET /health` |
| APK releases | https://github.com/bbscalton/gbti-payment-gateway/releases |

## Prerequisites

- Android Studio Hedgehog+ (SDK 34/35), JDK 17+
- Node.js 18+ (optional local Express / Worker)
- Cloudflare account (Wrangler logged in) for Worker deploy
- Firebase CLI / Google account for Firestore
- `gh` CLI for GitHub

## Run options

### A) Cloud stack (recommended demo)

1. Worker is already deployed (or `cd workers && npm ci --legacy-peer-deps && npx wrangler deploy`).
2. In Android Studio, select the **`cloudDebug`** variant (product flavor `cloud`).
3. Ensure `app/google-services.json` exists (download via Firebase CLI; not committed — see example file).
4. Run on emulator or device. App talks to the Worker over HTTPS and listens to Firestore for status.

### Build the APK (Windows)

```bat
cd C:\Users\Administrator\AndroidStudioProjects\Paymentgateway
.\gradlew.bat assembleCloudDebug
```

APK output: `app\build\outputs\apk\cloud\debug\app-cloud-debug.apk`

Or in Android Studio: **Build → Generate Signed Bundle / APK** (or Build APK) with the `cloud` flavor. Prefer publishing via [GitHub Releases](https://github.com/bbscalton/gbti-payment-gateway/releases) instead of committing binaries.

```bash
# Refresh google-services.json locally (do not commit)
npx -y firebase-tools@latest apps:sdkconfig ANDROID \
  1:1036768290031:android:858b2df3b28d3f8baca71a \
  --project gbti-payment-gateway -o app/google-services.json
```

### B) Local backend (Express)

```bash
cd backend
npm install
npm start
```

Use Android flavor **`localDebug`**. Emulator reaches host via `10.0.2.2:3000`.

### C) Local Worker

```bash
cd workers
cp .dev.vars.example .dev.vars
npm install --legacy-peer-deps
npm run dev
```

Point `local` flavor / `PUBLIC_BASE_URL` at the wrangler tunnel URL or `http://10.0.2.2:8787`.

## Test cards (sandbox only)

| Card number | Result |
|-------------|--------|
| `4111 1111 1111 1111` | Success → webhook `paid` |
| `4000 0000 0000 0002` | Decline → webhook `failed` |

Any future expiry + 3-digit CVV (e.g. `12` / `28` / `123`).

## API summary

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/orders` | Create order `{ amountCents, currency: "GYD", description }` |
| `GET` | `/orders/:id` | Fetch order |
| `POST` | `/orders/:id/pay` | Returns `{ checkoutUrl }` |
| `GET` | `/checkout/:id` | Hosted card form (HTML) |
| `POST` | `/mock-processor/charge` | Mock acquirer (card fields; not persisted) |
| `POST` | `/webhooks/payment` | HMAC webhook; updates status |
| `POST` | `/orders/:id/refund` | Refund stub |

## Secrets & authorize / redeploy

### Cloudflare

```bash
cd workers
npx wrangler login          # if needed — opens browser OAuth
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put FIREBASE_PROJECT_ID
npx wrangler secret put FIREBASE_CLIENT_EMAIL
npx wrangler secret put FIREBASE_PRIVATE_KEY   # PEM from service account JSON
npx wrangler deploy
```

### GitHub Actions deploy

Repo secrets required:

- `CLOUDFLARE_API_TOKEN` — Workers edit permission
- `CLOUDFLARE_ACCOUNT_ID` — `2aba2de5418ac0812383b628b6cb0f77` (this account)

Workflow: `.github/workflows/deploy-worker.yml` deploys `workers/` on push to `main`.

### Firebase

```bash
npx -y firebase-tools@latest login
npx -y firebase-tools@latest use gbti-payment-gateway
npx -y firebase-tools@latest deploy --only firestore
```

Console: https://console.firebase.google.com/project/gbti-payment-gateway/overview

Firestore rules: clients may **read** `orders/{id}`; writes only via Admin / Worker service account.

### Firebase MCP (Cursor)

If the Firebase MCP shows `needsAuth`, complete OAuth when prompted. CLI is already sufficient for this project (`neuereatec@gmail.com`).

## Key paths

| Path | Role |
|------|------|
| `workers/` | Cloudflare Worker (Hono) + D1 + Firestore mirror |
| `backend/` | Legacy local Express (same routes) |
| `app/` | Kotlin Compose merchant app |
| `firestore.rules` | Demo read-by-id rules |
| `.github/workflows/deploy-worker.yml` | Deploy on push |

## PCI / production note

Replace mock processor, secrets, and webhook scheme with real GBTI/acquirer credentials and PCI-scoped hosting before any live traffic.

## License

Demo / educational sandbox. Not affiliated with live GBTI production systems.
