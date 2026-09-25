/**
 * GBTI Bank — Sandbox Payment Gateway API
 *
 * CRITICAL: This merchant API never accepts, stores, or logs raw PAN/CVV.
 * Card entry happens only on the hosted checkout → mock processor path.
 * Order status becomes "paid" ONLY after a verified webhook signature.
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const orderStore = require("./orderStore");
const {
  processCard,
  signWebhookPayload,
  verifyWebhookSignature,
} = require("./mockProcessor");
const { renderCheckoutPage, renderResultPage } = require("./checkoutPages");

function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const WEBHOOK_SECRET =
  process.env.WEBHOOK_SECRET || "gbti_sandbox_webhook_secret_change_me";
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || `http://10.0.2.2:${PORT}`;

const app = express();

app.use(cors());
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);
app.use(express.urlencoded({ extended: false }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "gbti-payment-gateway-sandbox",
    note: "Mock only — not production GBTI credentials",
  });
});

/** Create order */
app.post("/orders", (req, res) => {
  const { amount, amountCents, currency, description } = req.body || {};
  const cents =
    typeof amountCents === "number"
      ? amountCents
      : typeof amount === "number"
        ? Math.round(amount * 100)
        : null;

  if (!cents || cents <= 0) {
    return res.status(400).json({ error: "amount or amountCents required (positive)" });
  }
  if (currency && currency !== "GYD") {
    return res.status(400).json({ error: "Only GYD is supported in this sandbox" });
  }

  const order = orderStore.createOrder({
    amountCents: cents,
    currency: "GYD",
    description: description || "Merchant purchase",
  });
  res.status(201).json(order);
});

app.get("/orders", (_req, res) => {
  res.json({ orders: orderStore.listOrders() });
});

app.get("/orders/:id", (req, res) => {
  const order = orderStore.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

/**
 * Start payment — returns hosted checkout URL.
 * Merchant app opens this URL; card entry never hits merchant APIs.
 */
app.post("/orders/:id/pay", (req, res) => {
  const order = orderStore.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status === "paid") {
    return res.status(409).json({ error: "Order already paid", order });
  }
  if (order.status === "refunded") {
    return res.status(409).json({ error: "Order already refunded", order });
  }

  const checkoutUrl = `${PUBLIC_BASE_URL}/checkout/${order.id}`;
  res.json({
    orderId: order.id,
    checkoutUrl,
    status: order.status,
  });
});

/** Hosted checkout page (HTML) */
app.get("/checkout/:id", (req, res) => {
  const order = orderStore.getOrder(req.params.id);
  if (!order) {
    return res.status(404).send("<h1>Order not found</h1>");
  }
  if (order.status === "paid") {
    return res.send(renderResultPage({ order, success: true }));
  }
  res.type("html").send(
    renderCheckoutPage({ order, publicBaseUrl: PUBLIC_BASE_URL })
  );
});

app.get("/checkout/:id/result", (req, res) => {
  const order = orderStore.getOrder(req.params.id);
  if (!order) return res.status(404).send("<h1>Order not found</h1>");
  const success = order.status === "paid";
  res.type("html").send(renderResultPage({ order, success }));
});

/**
 * Mock processor charge endpoint.
 * Receives card fields from hosted form ONLY — does not persist PAN.
 * Fires signed webhook to merchant webhook handler, then redirects.
 */
app.post("/mock-processor/charge", async (req, res) => {
  const { orderId, pan, expiryMonth, expiryYear, cvv } = req.body || {};
  const order = orderStore.getOrder(orderId);
  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  // Process in memory — never write pan/cvv to disk or logs
  const result = processCard({ pan, expiryMonth, expiryYear, cvv });

  const webhookPayload = {
    type: "payment.result",
    orderId: order.id,
    paymentRef: result.paymentRef,
    status: result.outcome,
    amountCents: order.amountCents,
    currency: order.currency,
    reason: result.reason || null,
    occurredAt: new Date().toISOString(),
  };

  const body = JSON.stringify(webhookPayload);
  const signature = signWebhookPayload(body, WEBHOOK_SECRET);

  // Deliver webhook to our own merchant endpoint (same process for demo)
  try {
    await deliverWebhook(body, signature);
  } catch (err) {
    console.error("[webhook] delivery failed:", err.message);
  }

  const redirectUrl = `${PUBLIC_BASE_URL}/checkout/${order.id}/result`;
  const wantsJson =
    (req.headers.accept || "").includes("application/json") ||
    req.xhr ||
    req.headers["x-requested-with"] === "XMLHttpRequest";

  if (wantsJson) {
    return res.json({
      ok: result.outcome === "paid",
      status: result.outcome,
      redirectUrl,
      message:
        result.outcome === "paid"
          ? "Payment accepted"
          : result.reason || "Payment declined",
    });
  }
  return res.redirect(303, redirectUrl);
});

async function deliverWebhook(body, signature) {
  // In-process call so the demo works without a second HTTP hop failing.
  // Signature is still verified identically to an external POST.
  return new Promise((resolve, reject) => {
    const fakeReq = {
      rawBody: body,
      body: JSON.parse(body),
      headers: { "x-gbti-signature": `sha256=${signature}` },
    };
    const fakeRes = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        if (this.statusCode >= 400) {
          reject(new Error(payload.error || "webhook rejected"));
        } else {
          resolve(payload);
        }
        return this;
      },
    };
    handlePaymentWebhook(fakeReq, fakeRes);
  });
}

/**
 * Merchant webhook — order marked paid/failed ONLY here after HMAC verify.
 */
function handlePaymentWebhook(req, res) {
  const signature =
    req.headers["x-gbti-signature"] || req.headers["x-signature"];
  const raw = req.rawBody || JSON.stringify(req.body || {});

  if (!verifyWebhookSignature(raw, signature, WEBHOOK_SECRET)) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  const event = typeof req.body === "object" ? req.body : JSON.parse(raw);
  if (event.type !== "payment.result") {
    return res.status(400).json({ error: "Unsupported event type" });
  }

  const order = orderStore.getOrder(event.orderId);
  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  // Idempotent: do not downgrade a paid order
  if (order.status === "paid") {
    return res.json({ ok: true, order, note: "already paid" });
  }

  const newStatus = event.status === "paid" ? "paid" : "failed";
  const updated = orderStore.updateOrder(order.id, {
    status: newStatus,
    paymentRef: event.paymentRef || null,
  });

  return res.json({ ok: true, order: updated });
}

app.post("/webhooks/payment", handlePaymentWebhook);

/** Optional refund stub — marks refunded; no real money movement */
app.post("/orders/:id/refund", (req, res) => {
  const order = orderStore.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status !== "paid") {
    return res.status(409).json({ error: "Only paid orders can be refunded" });
  }
  const updated = orderStore.updateOrder(order.id, { status: "refunded" });
  res.json({
    ok: true,
    order: updated,
    note: "Sandbox stub — no real funds moved. Production requires GBTI merchant API.",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`GBT I sandbox gateway listening on http://0.0.0.0:${PORT}`);
  console.log(`Public base URL (for Android emulator): ${PUBLIC_BASE_URL}`);
  console.log("Webhook secret: [sandbox placeholder — see .env.example]");
  console.log("Test cards: 4111111111111111 (success), 4000000000000002 (decline)");
});
