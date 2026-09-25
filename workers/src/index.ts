/**
 * GBTI Bank — Sandbox Payment Gateway (Cloudflare Worker / Hono)
 *
 * CRITICAL: This merchant API never accepts, stores, or logs raw PAN/CVV.
 * Card entry happens only on the hosted checkout → mock processor path.
 * Order status becomes "paid" ONLY after a verified webhook signature.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { renderCheckoutPage, renderResultPage } from "./checkoutPages";
import { firestoreConfigured, mirrorOrderToFirestore } from "./firestore";
import {
  processCard,
  signWebhookPayload,
  verifyWebhookSignature,
} from "./mockProcessor";
import { createOrder, getOrder, listOrders, updateOrder } from "./orders";
import type { Env, Order } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

function publicBase(c: { env: Env; req: { url: string } }): string {
  const configured = (c.env.PUBLIC_BASE_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(c.req.url).origin;
}

async function persistAndMirror(env: Env, order: Order): Promise<Order> {
  // Order already written to KV by caller; mirror is best-effort.
  await mirrorOrderToFirestore(env, order);
  return order;
}

const DOCS_URL = "https://bbscalton.github.io/gbti-payment-gateway/";

app.get("/", (c) =>
  c.json({
    ok: true,
    service: "gbti-payment-gateway-sandbox",
    runtime: "cloudflare-workers",
    health: "/health",
    docs: DOCS_URL,
    endpoints: {
      health: "GET /health",
      docs: "GET /docs",
      createOrder: "POST /orders",
      getOrder: "GET /orders/:id",
      pay: "POST /orders/:id/pay",
      checkout: "GET /checkout/:id",
    },
    note: "Mock/sandbox only — not production GBTI credentials",
  }),
);

app.get("/docs", (c) => c.redirect(DOCS_URL, 302));
app.get("/docs/", (c) => c.redirect(DOCS_URL, 302));

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "gbti-payment-gateway-sandbox",
    runtime: "cloudflare-workers",
    firestoreMirror: firestoreConfigured(c.env),
    docs: DOCS_URL,
    note: "Mock only — not production GBTI credentials",
  }),
);

app.post("/orders", async (c) => {
  let body: {
    amount?: number;
    amountCents?: number;
    currency?: string;
    description?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const cents =
    typeof body.amountCents === "number"
      ? body.amountCents
      : typeof body.amount === "number"
        ? Math.round(body.amount * 100)
        : null;

  if (!cents || cents <= 0) {
    return c.json({ error: "amount or amountCents required (positive)" }, 400);
  }
  if (body.currency && body.currency !== "GYD") {
    return c.json({ error: "Only GYD is supported in this sandbox" }, 400);
  }

  const order = await createOrder(c.env, {
    amountCents: cents,
    currency: "GYD",
    description: body.description || "Merchant purchase",
  });
  c.executionCtx.waitUntil(mirrorOrderToFirestore(c.env, order));
  return c.json(order, 201);
});

app.get("/orders", async (c) => {
  const orders = await listOrders(c.env);
  return c.json({ orders });
});

app.get("/orders/:id", async (c) => {
  const order = await getOrder(c.env, c.req.param("id"));
  if (!order) return c.json({ error: "Order not found" }, 404);
  return c.json(order);
});

app.post("/orders/:id/pay", async (c) => {
  const order = await getOrder(c.env, c.req.param("id"));
  if (!order) return c.json({ error: "Order not found" }, 404);
  if (order.status === "paid") {
    return c.json({ error: "Order already paid", order }, 409);
  }
  if (order.status === "refunded") {
    return c.json({ error: "Order already refunded", order }, 409);
  }

  const base = publicBase(c);
  return c.json({
    orderId: order.id,
    checkoutUrl: `${base}/checkout/${order.id}`,
    status: order.status,
  });
});

app.get("/checkout/:id", async (c) => {
  const order = await getOrder(c.env, c.req.param("id"));
  if (!order) return c.html("<h1>Order not found</h1>", 404);
  if (order.status === "paid") {
    return c.html(renderResultPage(order, true));
  }
  return c.html(renderCheckoutPage(order, publicBase(c)));
});

app.get("/checkout/:id/result", async (c) => {
  const order = await getOrder(c.env, c.req.param("id"));
  if (!order) return c.html("<h1>Order not found</h1>", 404);
  return c.html(renderResultPage(order, order.status === "paid"));
});

app.post("/mock-processor/charge", async (c) => {
  const contentType = c.req.header("content-type") || "";
  let orderId: string | undefined;
  let pan: string | undefined;
  let expiryMonth: string | undefined;
  let expiryYear: string | undefined;
  let cvv: string | undefined;

  if (contentType.includes("application/json")) {
    const body = await c.req.json<{
      orderId?: string;
      pan?: string;
      expiryMonth?: string;
      expiryYear?: string;
      cvv?: string;
    }>();
    orderId = body.orderId;
    pan = body.pan;
    expiryMonth = body.expiryMonth;
    expiryYear = body.expiryYear;
    cvv = body.cvv;
  } else {
    const form = await c.req.parseBody();
    orderId = String(form.orderId || "");
    pan = String(form.pan || "");
    expiryMonth = String(form.expiryMonth || "");
    expiryYear = String(form.expiryYear || "");
    cvv = String(form.cvv || "");
  }

  const order = orderId ? await getOrder(c.env, orderId) : null;
  if (!order) return c.json({ error: "Order not found" }, 404);

  // Process in memory — never write pan/cvv to KV, logs, or Firestore
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
  const secret = c.env.WEBHOOK_SECRET || "gbti_sandbox_webhook_secret_change_me";
  const signature = await signWebhookPayload(body, secret);

  const webhookResult = await applyPaymentWebhook(
    c.env,
    body,
    `sha256=${signature}`,
  );
  if (!webhookResult.ok) {
    console.error("[webhook] rejected:", webhookResult.error);
    return c.json(
      {
        ok: false,
        status: "failed",
        error: webhookResult.error || "Webhook processing failed",
        message: webhookResult.error || "Webhook processing failed",
      },
      (webhookResult.status as 400 | 401 | 404 | 500) || 500,
    );
  }

  // Re-read after update (KV can be eventually consistent across colos;
  // prefer the webhook result's order object when present).
  const confirmed = webhookResult.order || (await getOrder(c.env, order.id));
  const finalStatus = confirmed?.status || result.outcome;
  const redirectUrl = `${publicBase(c)}/checkout/${order.id}/result`;
  const accept = c.req.header("accept") || "";
  const wantsJson =
    accept.includes("application/json") ||
    c.req.header("x-requested-with") === "XMLHttpRequest";

  if (wantsJson) {
    return c.json({
      ok: finalStatus === "paid",
      status: finalStatus,
      redirectUrl,
      message:
        finalStatus === "paid"
          ? "Payment accepted"
          : result.reason || "Payment declined",
    });
  }
  return c.redirect(redirectUrl, 303);
});

async function applyPaymentWebhook(
  env: Env,
  rawBody: string,
  signatureHeader: string | undefined,
): Promise<{ ok: boolean; order?: Order; note?: string; error?: string; status: number }> {
  const secret = env.WEBHOOK_SECRET || "gbti_sandbox_webhook_secret_change_me";
  const valid = await verifyWebhookSignature(rawBody, signatureHeader, secret);
  if (!valid) {
    return { ok: false, error: "Invalid webhook signature", status: 401 };
  }

  const event = JSON.parse(rawBody) as {
    type?: string;
    orderId?: string;
    status?: string;
    paymentRef?: string;
  };
  if (event.type !== "payment.result") {
    return { ok: false, error: "Unsupported event type", status: 400 };
  }
  if (!event.orderId) {
    return { ok: false, error: "Missing orderId", status: 400 };
  }

  const order = await getOrder(env, event.orderId);
  if (!order) {
    return { ok: false, error: "Order not found", status: 404 };
  }

  if (order.status === "paid") {
    return { ok: true, order, note: "already paid", status: 200 };
  }

  const newStatus = event.status === "paid" ? "paid" : "failed";
  const updated = await updateOrder(env, order.id, {
    status: newStatus,
    paymentRef: event.paymentRef || null,
  });
  if (updated) {
    await persistAndMirror(env, updated);
  }
  return { ok: true, order: updated || order, status: 200 };
}

app.post("/webhooks/payment", async (c) => {
  const raw = await c.req.text();
  const signature =
    c.req.header("x-gbti-signature") || c.req.header("x-signature") || undefined;
  const result = await applyPaymentWebhook(c.env, raw, signature);
  if (!result.ok) {
    return c.json({ error: result.error }, result.status as 400 | 401 | 404);
  }
  return c.json({
    ok: true,
    order: result.order,
    note: result.note,
  });
});

app.post("/orders/:id/refund", async (c) => {
  const order = await getOrder(c.env, c.req.param("id"));
  if (!order) return c.json({ error: "Order not found" }, 404);
  if (order.status !== "paid") {
    return c.json({ error: "Only paid orders can be refunded" }, 409);
  }
  const updated = await updateOrder(c.env, order.id, { status: "refunded" });
  if (updated) {
    c.executionCtx.waitUntil(mirrorOrderToFirestore(c.env, updated));
  }
  return c.json({
    ok: true,
    order: updated,
    note: "Sandbox stub — no real funds moved. Production requires GBTI merchant API.",
  });
});

export default app;
