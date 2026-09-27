/**
 * Sapp — Payment Gateway (Cloudflare Worker / Hono)
 * 
 * A secure, multi-tenant payment gateway sandbox.
 * CRITICAL: This merchant API never accepts, stores, or logs raw PAN/CVV.
 * Card entry happens only on the hosted checkout → mock processor path.
 * Order status changes ONLY after verified webhook signature.
 * 
 * Sapp by Neuereatec Enterprise. All rights reserved.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { 
  renderCheckoutPage, 
  renderResultPage, 
  render3dsChallengePage,
  getSecurityHeaders 
} from "./checkoutPages";
import { firestoreConfigured, mirrorOrderToFirestore } from "./firestore";
import {
  processCard,
  signWebhookPayload,
  verifyWebhookSignature,
  TEST_CARDS,
} from "./mockProcessor";
import { 
  createOrder, 
  getOrder, 
  getOrderForMerchant,
  listOrdersForMerchant, 
  updateOrder,
  findByIdempotencyKey,
  capture,
  refund as refundOrder,
  voidOrder,
  isValidTransition,
} from "./orders";
import { 
  authenticateMerchant, 
  createMerchant, 
  getMerchant,
  updateMerchant,
  rotateApiKeys,
  listMerchants,
  issueLiveKey,
} from "./merchants";
import { checkAdminAuth } from "./admin";
import { 
  createWebhookEvent, 
  deliverWebhook, 
  listWebhookEventsForMerchant,
  redeliverWebhook,
} from "./webhooks";
import { 
  getMerchantBalance, 
  listLedgerEntries, 
  recordPaymentReceived,
  recordRefund,
  generateSettlementReport,
  listSettlementReports,
} from "./ledger";
import { 
  createDispute, 
  getDisputeForMerchant, 
  listDisputesForMerchant,
  submitEvidence,
} from "./disputes";
import { logAuditEvent, listAuditLogs } from "./audit";
import {
  SANDBOX_3DS_OTP,
  createChallenge,
  getChallenge,
  recordAttempt,
  finishChallenge,
  isChallengeExpired,
  isCorrectSandboxOtp,
} from "./threeDs";
import { 
  getIdempotencyRecord, 
  setIdempotencyRecord,
  checkReplayProtection,
  markEventProcessed,
} from "./idempotency";
import { createError, HTTP_STATUS, ERROR_MESSAGES } from "./errors";
import type { Env, Order, Merchant, ErrorCode } from "./types";

const app = new Hono<{ Bindings: Env }>();

const DOCS_URL = "https://bbscalton.github.io/sapp-gateway/";
const API_VERSION = "v1";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 100;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getRateLimitKey(ip: string, merchantId?: string): string {
  return merchantId ? `merchant:${merchantId}` : `ip:${ip}`;
}

function checkRateLimit(key: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }
  
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  
  entry.count++;
  return { allowed: true };
}

function getAllowedOrigins(env: Env): string[] {
  const origins = env.ALLOWED_ORIGINS?.trim();
  if (!origins) return [];
  return origins.split(",").map(o => o.trim()).filter(Boolean);
}

function publicBase(c: { env: Env; req: { url: string } }): string {
  const configured = (c.env.PUBLIC_BASE_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(c.req.url).origin;
}

function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("cf-connecting-ip") || 
         c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || 
         "unknown";
}

app.use("*", async (c, next) => {
  const allowedOrigins = getAllowedOrigins(c.env);
  const origin = c.req.header("origin");
  
  if (allowedOrigins.length === 0) {
    return cors()(c, next);
  }
  
  if (origin && allowedOrigins.includes(origin)) {
    return cors({ origin })(c, next);
  }
  
  if (allowedOrigins.includes("*")) {
    return cors()(c, next);
  }
  
  return cors({ origin: allowedOrigins[0] })(c, next);
});

app.use("*", async (c, next) => {
  const ip = getClientIp(c);
  const key = getRateLimitKey(ip);
  const { allowed, retryAfter } = checkRateLimit(key);
  
  if (!allowed) {
    return c.json(createError("rate_limited", undefined, { retryAfter }), 429);
  }
  
  await next();
});

async function requireAuth(
  c: { env: Env; req: { header: (name: string) => string | undefined } }
): Promise<{ merchant: Merchant; isTestMode: boolean } | null> {
  const authHeader = c.req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  
  const apiKey = authHeader.slice(7);
  return authenticateMerchant(c.env, apiKey);
}

/**
 * Admin guard: `Authorization: Bearer <MERCHANT_MASTER_KEY>`.
 * Returns a Response to send when the caller is NOT an admin, or null if OK.
 */
function adminGuard(c: any): Response | null {
  const result = checkAdminAuth(c.req.header("authorization"), c.env.MERCHANT_MASTER_KEY);
  if (result === "ok") return null;
  if (result === "not_configured") {
    return c.json(createError("internal_error", "Admin access is not configured on this gateway"), 503);
  }
  if (result === "missing") {
    return c.json(createError("authentication_required", "Admin authorization required"), 401);
  }
  return c.json(createError("forbidden", "Invalid admin credentials"), 403);
}

async function requireWebhookSecret(env: Env): Promise<string | null> {
  const secret = env.WEBHOOK_SECRET;
  if (!secret) return null;
  return secret;
}

app.get("/", (c) =>
  c.json({
    ok: true,
    service: "sapp-gateway",
    version: API_VERSION,
    runtime: "cloudflare-workers",
    health: "/health",
    docs: DOCS_URL,
    endpoints: {
      health: "GET /health",
      docs: "GET /docs",
      createOrder: "POST /v1/orders",
      getOrder: "GET /v1/orders/:id",
      pay: "POST /v1/orders/:id/pay",
      capture: "POST /v1/orders/:id/capture",
      refund: "POST /v1/orders/:id/refund",
      void: "POST /v1/orders/:id/void",
      checkout: "GET /checkout/:id",
      webhooks: "GET /v1/webhooks/events",
      ledger: "GET /v1/ledger",
      settlements: "GET /v1/settlements",
      disputes: "GET /v1/disputes",
    },
    note: "Sandbox mode — no real payments processed",
  })
);

app.get("/docs", (c) => c.redirect(DOCS_URL, 302));
app.get("/docs/", (c) => c.redirect(DOCS_URL, 302));

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "sapp-gateway",
    version: API_VERSION,
    runtime: "cloudflare-workers",
    firestoreMirror: firestoreConfigured(c.env),
    docs: DOCS_URL,
    note: "Sandbox mode — no real payments processed",
  })
);

// Admin-only: merchant onboarding. Issues a sandbox test key (sk_test_) only.
app.post("/v1/merchants", async (c) => {
  const denied = adminGuard(c);
  if (denied) return denied;

  let body: {
    name?: string;
    email?: string;
    webhookUrl?: string;
    kybData?: Record<string, unknown>;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json(createError("invalid_request", "Invalid JSON body"), 400);
  }

  if (!body.name || !body.email) {
    return c.json(createError("invalid_request", "name and email are required"), 400);
  }

  try {
    const result = await createMerchant(c.env, {
      name: body.name,
      email: body.email,
      webhookUrl: body.webhookUrl,
      kybData: body.kybData as any,
    });

    await logAuditEvent(c.env, {
      merchantId: result.merchant.id,
      action: "merchant.created",
      resourceType: "merchant",
      resourceId: result.merchant.id,
      actorType: "admin",
      ipAddress: getClientIp(c),
    });

    return c.json({
      merchant: {
        id: result.merchant.id,
        name: result.merchant.name,
        email: result.merchant.email,
        status: result.merchant.status,
        webhookUrl: result.merchant.webhookUrl,
        createdAt: result.merchant.createdAt,
      },
      testApiKey: result.testApiKey,
      note: "Store this test API key securely. It will not be shown again. Live keys are issued only by an admin after the merchant is approved.",
    }, 201);
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint")) {
      return c.json(createError("invalid_request", "Email already registered"), 409);
    }
    throw e;
  }
});

// Admin-only: change merchant status (pending | approved | suspended).
app.post("/v1/admin/merchants/:id/status", async (c) => {
  const denied = adminGuard(c);
  if (denied) return denied;

  let body: { status?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json(createError("invalid_request", "Invalid JSON body"), 400);
  }
  const allowed = ["pending", "approved", "suspended"];
  if (!body.status || !allowed.includes(body.status)) {
    return c.json(createError("invalid_request", `status must be one of: ${allowed.join(", ")}`), 400);
  }

  const updated = await updateMerchant(c.env, c.req.param("id"), { status: body.status as any });
  if (!updated) return c.json(createError("merchant_not_found"), 404);

  await logAuditEvent(c.env, {
    merchantId: updated.id,
    action: "merchant.updated",
    resourceType: "merchant",
    resourceId: updated.id,
    actorType: "admin",
    ipAddress: getClientIp(c),
    details: { status: updated.status },
  });

  return c.json({ merchant: { id: updated.id, status: updated.status, updatedAt: updated.updatedAt } });
});

// Admin-only: issue (or rotate) a live key for an APPROVED merchant.
app.post("/v1/admin/merchants/:id/live-key", async (c) => {
  const denied = adminGuard(c);
  if (denied) return denied;

  const result = await issueLiveKey(c.env, c.req.param("id"));
  if ("error" in result) {
    if (result.error === "merchant_not_found") return c.json(createError("merchant_not_found"), 404);
    return c.json(createError("forbidden", "Merchant must be approved before a live key can be issued"), 403);
  }

  await logAuditEvent(c.env, {
    merchantId: c.req.param("id"),
    action: "merchant.api_key_rotated",
    resourceType: "merchant",
    resourceId: c.req.param("id"),
    actorType: "admin",
    ipAddress: getClientIp(c),
    details: { keyType: "live" },
  });

  return c.json({
    merchantId: c.req.param("id"),
    liveApiKey: result.apiKey,
    note: "Store this live API key securely. It will not be shown again.",
  }, 201);
});

app.get("/v1/merchants/me", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  const balance = await getMerchantBalance(c.env, auth.merchant.id);

  return c.json({
    merchant: {
      id: auth.merchant.id,
      name: auth.merchant.name,
      email: auth.merchant.email,
      status: auth.merchant.status,
      webhookUrl: auth.merchant.webhookUrl,
      createdAt: auth.merchant.createdAt,
      updatedAt: auth.merchant.updatedAt,
    },
    balance: {
      availableCents: balance,
      currency: "GYD",
    },
    isTestMode: auth.isTestMode,
  });
});

app.post("/v1/orders", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  if (auth.merchant.status !== "approved" && auth.merchant.status !== "pending") {
    return c.json(createError("forbidden", "Merchant account is not active"), 403);
  }

  const idempotencyKey = c.req.header("idempotency-key");
  
  if (idempotencyKey) {
    const existing = await getIdempotencyRecord(c.env, auth.merchant.id, idempotencyKey);
    if (existing) {
      return c.json(JSON.parse(existing.response), existing.statusCode as 200 | 201 | 400 | 409);
    }
    
    const existingOrder = await findByIdempotencyKey(c.env, auth.merchant.id, idempotencyKey);
    if (existingOrder) {
      return c.json(existingOrder, 200);
    }
  }

  let body: {
    amount?: number;
    amountCents?: number;
    currency?: string;
    description?: string;
    metadata?: Record<string, string>;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json(createError("invalid_request", "Invalid JSON body"), 400);
  }

  const cents =
    typeof body.amountCents === "number"
      ? body.amountCents
      : typeof body.amount === "number"
        ? Math.round(body.amount * 100)
        : null;

  if (!cents || cents <= 0) {
    return c.json(createError("invalid_amount", "amount or amountCents required (positive)"), 400);
  }
  if (body.currency && body.currency !== "GYD") {
    return c.json(createError("invalid_currency", "Only GYD is supported"), 400);
  }

  const order = await createOrder(c.env, {
    merchantId: auth.merchant.id,
    amountCents: cents,
    currency: "GYD",
    description: body.description || "Payment",
    idempotencyKey: idempotencyKey || undefined,
    metadata: body.metadata,
  });

  c.executionCtx.waitUntil(mirrorOrderToFirestore(c.env, order));

  await logAuditEvent(c.env, {
    merchantId: auth.merchant.id,
    action: "order.created",
    resourceType: "order",
    resourceId: order.id,
    actorType: "merchant",
    actorId: auth.merchant.id,
    ipAddress: getClientIp(c),
  });

  if (idempotencyKey) {
    await setIdempotencyRecord(c.env, auth.merchant.id, idempotencyKey, JSON.stringify(order), 201);
  }

  return c.json(order, 201);
});

app.get("/v1/orders", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 200);
  const offset = parseInt(c.req.query("offset") || "0");
  const status = c.req.query("status") as any;

  const orders = await listOrdersForMerchant(c.env, auth.merchant.id, { 
    limit, 
    offset,
    status,
  });
  
  return c.json({ orders, limit, offset });
});

app.get("/v1/orders/:id", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  const order = await getOrderForMerchant(c.env, c.req.param("id"), auth.merchant.id);
  if (!order) return c.json(createError("order_not_found"), 404);
  
  return c.json(order);
});

app.post("/v1/orders/:id/pay", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  const order = await getOrderForMerchant(c.env, c.req.param("id"), auth.merchant.id);
  if (!order) return c.json(createError("order_not_found"), 404);
  
  if (order.status === "captured" || order.status === "authorized") {
    return c.json(createError("invalid_state_transition", "Order already processed"), 409);
  }
  if (order.status === "refunded") {
    return c.json(createError("invalid_state_transition", "Order already refunded"), 409);
  }

  const base = publicBase(c);
  return c.json({
    orderId: order.id,
    checkoutUrl: `${base}/checkout/${order.id}`,
    status: order.status,
  });
});

app.post("/v1/orders/:id/capture", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  const order = await getOrderForMerchant(c.env, c.req.param("id"), auth.merchant.id);
  if (!order) return c.json(createError("order_not_found"), 404);

  let body: { amountCents?: number } = {};
  try {
    body = await c.req.json();
  } catch {
  }

  const amountCents = body.amountCents || (order.amountCents - order.capturedCents);
  
  if (amountCents > order.amountCents - order.capturedCents) {
    return c.json(createError("capture_exceeds_authorized"), 400);
  }

  const paymentRef = `cap_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const updated = await capture(c.env, order.id, amountCents, paymentRef);
  
  if (!updated) {
    return c.json(createError("invalid_state_transition"), 409);
  }

  await recordPaymentReceived(c.env, auth.merchant.id, order.id, amountCents, "GYD");

  await logAuditEvent(c.env, {
    merchantId: auth.merchant.id,
    action: "order.captured",
    resourceType: "order",
    resourceId: order.id,
    actorType: "merchant",
    actorId: auth.merchant.id,
    ipAddress: getClientIp(c),
    details: { amountCents },
  });

  if (auth.merchant.webhookUrl) {
    const event = await createWebhookEvent(c.env, auth.merchant.id, order.id, "payment.captured", updated);
    c.executionCtx.waitUntil(deliverWebhook(c.env, event, auth.merchant));
  }

  c.executionCtx.waitUntil(mirrorOrderToFirestore(c.env, updated));
  
  return c.json(updated);
});

app.post("/v1/orders/:id/refund", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  const order = await getOrderForMerchant(c.env, c.req.param("id"), auth.merchant.id);
  if (!order) return c.json(createError("order_not_found"), 404);

  // Refund idempotency keys are scoped by merchant AND order, so reusing a key
  // on a different order never replays another order's refund response.
  const rawIdempotencyKey = c.req.header("idempotency-key");
  const idempotencyKey = rawIdempotencyKey ? refundIdempotencyKey(order.id, rawIdempotencyKey) : undefined;
  if (idempotencyKey) {
    const existing = await getIdempotencyRecord(c.env, auth.merchant.id, idempotencyKey);
    if (existing) {
      return c.json(JSON.parse(existing.response), existing.statusCode as 200 | 201 | 400 | 409);
    }
  }

  let body: { amountCents?: number } = {};
  try {
    body = await c.req.json();
  } catch {
  }

  const maxRefundable = order.capturedCents - order.refundedCents;
  const amountCents = body.amountCents || maxRefundable;
  
  if (amountCents > maxRefundable) {
    return c.json(createError("refund_exceeds_captured", `Maximum refundable: ${maxRefundable} cents`), 400);
  }

  const updated = await refundOrder(c.env, order.id, amountCents);
  if (!updated) {
    return c.json(createError("invalid_state_transition", "Order cannot be refunded in current state"), 409);
  }

  await recordRefund(c.env, auth.merchant.id, order.id, amountCents, "GYD");

  await logAuditEvent(c.env, {
    merchantId: auth.merchant.id,
    action: "order.refunded",
    resourceType: "order",
    resourceId: order.id,
    actorType: "merchant",
    actorId: auth.merchant.id,
    ipAddress: getClientIp(c),
    details: { amountCents },
  });

  if (auth.merchant.webhookUrl) {
    const event = await createWebhookEvent(c.env, auth.merchant.id, order.id, "payment.refunded", updated);
    c.executionCtx.waitUntil(deliverWebhook(c.env, event, auth.merchant));
  }

  c.executionCtx.waitUntil(mirrorOrderToFirestore(c.env, updated));

  const response = {
    ok: true,
    order: updated,
    note: "Sandbox — no real funds refunded",
  };

  if (idempotencyKey) {
    await setIdempotencyRecord(c.env, auth.merchant.id, idempotencyKey, JSON.stringify(response), 200);
  }
  
  return c.json(response);
});

app.post("/v1/orders/:id/void", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  const order = await getOrderForMerchant(c.env, c.req.param("id"), auth.merchant.id);
  if (!order) return c.json(createError("order_not_found"), 404);

  const updated = await voidOrder(c.env, order.id);
  if (!updated) {
    return c.json(createError("invalid_state_transition", "Order cannot be voided in current state"), 409);
  }

  await logAuditEvent(c.env, {
    merchantId: auth.merchant.id,
    action: "order.voided",
    resourceType: "order",
    resourceId: order.id,
    actorType: "merchant",
    actorId: auth.merchant.id,
    ipAddress: getClientIp(c),
  });

  if (auth.merchant.webhookUrl) {
    const event = await createWebhookEvent(c.env, auth.merchant.id, order.id, "payment.voided", updated);
    c.executionCtx.waitUntil(deliverWebhook(c.env, event, auth.merchant));
  }

  c.executionCtx.waitUntil(mirrorOrderToFirestore(c.env, updated));
  
  return c.json({ ok: true, order: updated });
});

app.get("/checkout/:id", async (c) => {
  const order = await getOrder(c.env, c.req.param("id"));
  if (!order) {
    return c.html("<h1>Order not found</h1>", 404);
  }
  
  if (order.status === "captured" || order.status === "authorized") {
    const headers = getSecurityHeaders();
    return c.html(renderResultPage(order, true), { headers });
  }
  
  const headers = getSecurityHeaders();
  return c.html(renderCheckoutPage(order, publicBase(c)), { headers });
});

app.get("/checkout/:id/result", async (c) => {
  const order = await getOrder(c.env, c.req.param("id"));
  if (!order) {
    return c.html("<h1>Order not found</h1>", 404);
  }
  
  const success = order.status === "captured" || order.status === "authorized";
  const headers = getSecurityHeaders();
  return c.html(renderResultPage(order, success), { headers });
});

export function refundIdempotencyKey(orderId: string, key: string): string {
  return `refund:${orderId}:${key}`;
}

function wantsJsonResponse(c: { req: { header: (n: string) => string | undefined } }): boolean {
  const accept = c.req.header("accept") || "";
  return accept.includes("application/json") || c.req.header("x-requested-with") === "XMLHttpRequest";
}

/** Fail an order whose 3DS challenge could not be completed (attempts exhausted / expired). */
async function failOrderAfter3ds(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, order: Order): Promise<Order | null> {
  if (!isValidTransition(order.status, "failed")) return null;
  const updated = await updateOrder(env, order.id, { status: "failed", threeDsStatus: "failed" });
  if (updated) {
    const merchant = await getMerchant(env, order.merchantId);
    if (merchant?.webhookUrl) {
      const event = await createWebhookEvent(env, merchant.id, order.id, "payment.failed", updated);
      ctx.waitUntil(deliverWebhook(env, event, merchant));
    }
    ctx.waitUntil(mirrorOrderToFirestore(env, updated));
  }
  return updated;
}

app.get("/3ds-challenge/:challengeId", async (c) => {
  const challenge = await getChallenge(c.env, c.req.param("challengeId"));
  if (!challenge) {
    return c.html("<h1>Challenge not found</h1>", 404, getSecurityHeaders());
  }
  const order = await getOrder(c.env, challenge.orderId);
  if (!order) {
    return c.html("<h1>Order not found</h1>", 404, getSecurityHeaders());
  }
  if (challenge.status !== "pending" || isChallengeExpired(challenge)) {
    const success = order.status === "captured" || order.status === "authorized";
    return c.html(renderResultPage(order, success), { headers: getSecurityHeaders() });
  }
  const error = c.req.query("error") === "invalid_code" ? "Incorrect code. Please try again." : undefined;
  return c.html(
    render3dsChallengePage(order, challenge.id, publicBase(c), {
      error,
      attemptsRemaining: Math.max(0, challenge.maxAttempts - challenge.attempts),
      sandboxOtp: SANDBOX_3DS_OTP,
    }),
    { headers: getSecurityHeaders() }
  );
});

/**
 * Complete a 3-D Secure challenge. The order is captured ONLY when a pending,
 * unexpired, server-issued challenge for a pending-3DS order is presented with
 * the correct OTP. Challenges are single-use and allow THREE_DS_MAX_ATTEMPTS tries.
 */
app.post("/3ds-complete", async (c) => {
  const contentType = c.req.header("content-type") || "";
  let challengeId = "";
  let code = "";
  let claimedOrderId = "";
  if (contentType.includes("application/json")) {
    const body = await c.req.json<{ challengeId?: string; code?: string; orderId?: string }>().catch(() => ({} as any));
    challengeId = String(body.challengeId || "");
    code = String(body.code || "");
    claimedOrderId = String(body.orderId || "");
  } else {
    const form = await c.req.parseBody();
    challengeId = String(form.challengeId || "");
    code = String(form.code || "");
    claimedOrderId = String(form.orderId || "");
  }

  const json = wantsJsonResponse(c);
  const base = publicBase(c);
  const reject = (status: 400 | 404 | 409 | 410, errCode: ErrorCode, message: string, extra: Record<string, unknown> = {}) =>
    json
      ? c.json({ ...createError(errCode, message), ok: false, ...extra }, status)
      : c.html(`<h1>${message}</h1>`, status, getSecurityHeaders());

  // 1. A server-issued challenge must be presented.
  const challenge = challengeId ? await getChallenge(c.env, challengeId) : null;
  if (!challenge) {
    return reject(400, "3ds_failed", "No valid 3-D Secure challenge was presented");
  }
  if (claimedOrderId && claimedOrderId !== challenge.orderId) {
    return reject(400, "3ds_failed", "Challenge does not match this order");
  }

  // 2. Single-use: only pending challenges can be completed.
  if (challenge.status !== "pending") {
    return reject(409, "invalid_state_transition", "This 3-D Secure challenge has already been used or closed", {
      challengeStatus: challenge.status,
    });
  }

  const order = await getOrder(c.env, challenge.orderId);
  if (!order) {
    return reject(404, "order_not_found", "Order not found");
  }

  // 3. The order must be waiting for exactly this kind of step.
  if (order.status !== "pending" || order.threeDsStatus !== "challenge_required") {
    await finishChallenge(c.env, challenge.id, "superseded");
    return reject(409, "invalid_state_transition", "Order is not awaiting 3-D Secure authentication");
  }

  // 4. Expiry.
  if (isChallengeExpired(challenge)) {
    if (await finishChallenge(c.env, challenge.id, "expired")) {
      await failOrderAfter3ds(c.env, c.executionCtx, order);
    }
    return json
      ? c.json({ ...createError("3ds_failed", "3-D Secure challenge expired"), ok: false, status: "failed", redirectUrl: `${base}/checkout/${order.id}/result` }, 410)
      : c.redirect(`${base}/checkout/${order.id}/result`, 303);
  }

  // 5. Count the attempt atomically (fails if no attempts are left).
  const attempts = await recordAttempt(c.env, challenge.id);
  if (attempts === null) {
    return reject(409, "invalid_state_transition", "This 3-D Secure challenge has no attempts left");
  }

  // 6. Verify the OTP.
  if (!isCorrectSandboxOtp(code)) {
    const remaining = Math.max(0, challenge.maxAttempts - attempts);
    if (remaining === 0) {
      if (await finishChallenge(c.env, challenge.id, "failed")) {
        await failOrderAfter3ds(c.env, c.executionCtx, order);
      }
      return json
        ? c.json({ ...createError("3ds_failed", "Too many incorrect codes. Payment failed."), ok: false, status: "failed", attemptsRemaining: 0, redirectUrl: `${base}/checkout/${order.id}/result` }, 400)
        : c.redirect(`${base}/checkout/${order.id}/result`, 303);
    }
    return json
      ? c.json({ ...createError("3ds_failed", "Incorrect 3-D Secure code"), ok: false, status: "challenge_required", attemptsRemaining: remaining }, 400)
      : c.redirect(`${base}/3ds-challenge/${challenge.id}?error=invalid_code`, 303);
  }

  // 7. Consume the challenge (single-use, race-safe) and only then capture.
  if (!(await finishChallenge(c.env, challenge.id, "succeeded"))) {
    return reject(409, "invalid_state_transition", "This 3-D Secure challenge has already been used or closed");
  }
  const updatedAuth = await updateOrder(c.env, order.id, { threeDsStatus: "authenticated" });
  const updated = updatedAuth ? await capture(c.env, order.id, order.amountCents, challenge.paymentRef) : null;
  if (!updated) {
    return reject(409, "invalid_state_transition", "Order could not be captured");
  }

  const merchant = await getMerchant(c.env, order.merchantId);
  if (merchant) {
    await recordPaymentReceived(c.env, merchant.id, order.id, order.amountCents, "GYD");
    if (merchant.webhookUrl) {
      const event = await createWebhookEvent(c.env, merchant.id, order.id, "payment.captured", updated);
      c.executionCtx.waitUntil(deliverWebhook(c.env, event, merchant));
    }
  }
  c.executionCtx.waitUntil(mirrorOrderToFirestore(c.env, updated));

  return json
    ? c.json({ ok: true, status: updated.status, redirectUrl: `${base}/checkout/${order.id}/result`, message: "Payment accepted" })
    : c.redirect(`${base}/checkout/${order.id}/result`, 303);
});

app.post("/mock-processor/charge", async (c) => {
  const secret = await requireWebhookSecret(c.env);
  if (!secret) {
    return c.json(createError("webhook_secret_missing"), 500);
  }

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
  if (!order) return c.json(createError("order_not_found"), 404);

  const result = processCard({ pan, expiryMonth, expiryYear, cvv, captureNow: true });

  if (result.outcome === "3ds_required") {
    // Only a pending order can enter 3DS; record a server-side challenge.
    if (order.status !== "pending") {
      return c.json(createError("invalid_state_transition", "Order is not payable in its current state"), 409);
    }
    await updateOrder(c.env, order.id, { threeDsStatus: "challenge_required" });
    const challenge = await createChallenge(c.env, order.id, result.paymentRef);
    const redirectUrl = `${publicBase(c)}/3ds-challenge/${challenge.id}`;

    if (wantsJsonResponse(c)) {
      return c.json({
        ok: false,
        status: "3ds_required",
        challengeId: challenge.id,
        challengeExpiresAt: challenge.expiresAt,
        threeDsChallengeUrl: redirectUrl,
        redirectUrl,
        message: "3-D Secure verification required",
      });
    }
    return c.redirect(redirectUrl, 303);
  }

  const webhookPayload = {
    id: `evt_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    type: "payment.result",
    orderId: order.id,
    paymentRef: result.paymentRef,
    status: result.outcome === "captured" ? "captured" : "failed",
    amountCents: order.amountCents,
    currency: order.currency,
    reason: result.reason || null,
    occurredAt: new Date().toISOString(),
  };
  const body = JSON.stringify(webhookPayload);
  const signature = await signWebhookPayload(body, secret);

  const webhookResult = await applyPaymentWebhook(c.env, body, signature, secret);
  
  if (!webhookResult.ok) {
    return c.json({
      ok: false,
      status: "failed",
      error: webhookResult.error,
      message: webhookResult.error || "Payment processing failed",
    }, (webhookResult.status as 400 | 401 | 404 | 500) || 500);
  }

  const confirmed = webhookResult.order || (await getOrder(c.env, order.id));
  const finalStatus = confirmed?.status || result.outcome;
  const redirectUrl = `${publicBase(c)}/checkout/${order.id}/result`;
  
  const accept = c.req.header("accept") || "";
  const wantsJson = accept.includes("application/json") || c.req.header("x-requested-with") === "XMLHttpRequest";

  if (wantsJson) {
    return c.json({
      ok: finalStatus === "captured",
      status: finalStatus,
      redirectUrl,
      message: finalStatus === "captured" ? "Payment accepted" : ERROR_MESSAGES[result.reason as ErrorCode] || "Payment declined",
    });
  }
  return c.redirect(redirectUrl, 303);
});

async function applyPaymentWebhook(
  env: Env,
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string
): Promise<{ ok: boolean; order?: Order; note?: string; error?: string; status: number }> {
  const verification = await verifyWebhookSignature(rawBody, signatureHeader, secret);
  if (!verification.valid) {
    return { ok: false, error: `Invalid webhook signature: ${verification.reason}`, status: 401 };
  }

  const event = JSON.parse(rawBody) as {
    id?: string;
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

  if (event.id) {
    const isReplay = await checkReplayProtection(env, event.id);
    if (isReplay) {
      return { ok: false, error: "Webhook event already processed", status: 409 };
    }
    await markEventProcessed(env, event.id);
  }

  const order = await getOrder(env, event.orderId);
  if (!order) {
    return { ok: false, error: "Order not found", status: 404 };
  }

  if (order.status === "captured") {
    return { ok: true, order, note: "already captured", status: 200 };
  }

  const newStatus = event.status === "captured" ? "captured" : "failed";
  
  let updated: Order | null = null;
  if (newStatus === "captured") {
    updated = await capture(env, order.id, order.amountCents, event.paymentRef || "");
    
    if (updated) {
      const merchant = await getMerchant(env, order.merchantId);
      if (merchant) {
        await recordPaymentReceived(env, merchant.id, order.id, order.amountCents, "GYD");
        
        if (merchant.webhookUrl) {
          const webhookEvent = await createWebhookEvent(env, merchant.id, order.id, "payment.captured", updated);
          deliverWebhook(env, webhookEvent, merchant).catch(() => {});
        }
      }
    }
  } else {
    updated = await updateOrder(env, order.id, {
      status: "failed",
      paymentRef: event.paymentRef || null,
    });
    
    if (updated) {
      const merchant = await getMerchant(env, order.merchantId);
      if (merchant?.webhookUrl) {
        const webhookEvent = await createWebhookEvent(env, merchant.id, order.id, "payment.failed", updated);
        deliverWebhook(env, webhookEvent, merchant).catch(() => {});
      }
    }
  }

  if (updated) {
    mirrorOrderToFirestore(env, updated).catch(() => {});
  }
  
  return { ok: true, order: updated || order, status: 200 };
}

app.post("/webhooks/payment", async (c) => {
  const secret = await requireWebhookSecret(c.env);
  if (!secret) {
    return c.json(createError("webhook_secret_missing"), 500);
  }

  const raw = await c.req.text();
  const signature = c.req.header("x-sapp-signature") || undefined;
  
  const result = await applyPaymentWebhook(c.env, raw, signature, secret);
  if (!result.ok) {
    return c.json({ error: result.error }, result.status as 400 | 401 | 404 | 409 | 500);
  }
  return c.json({
    ok: true,
    order: result.order,
    note: result.note,
  });
});

app.get("/v1/webhooks/events", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 200);
  const offset = parseInt(c.req.query("offset") || "0");
  const status = c.req.query("status") as any;

  const events = await listWebhookEventsForMerchant(c.env, auth.merchant.id, {
    limit,
    offset,
    status,
  });

  return c.json({ events, limit, offset });
});

app.post("/v1/webhooks/events/:id/redeliver", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  // Ownership-scoped: another merchant's event is reported as 404 (not 403)
  // so the endpoint does not reveal that the event exists.
  const event = await redeliverWebhook(c.env, auth.merchant.id, c.req.param("id"));
  if (!event) {
    return c.json(createError("not_found"), 404);
  }

  c.executionCtx.waitUntil(deliverWebhook(c.env, event, auth.merchant));

  return c.json({ ok: true, event });
});

app.get("/v1/ledger", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 200);
  const offset = parseInt(c.req.query("offset") || "0");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  const entries = await listLedgerEntries(c.env, auth.merchant.id, {
    limit,
    offset,
    startDate,
    endDate,
  });

  const balance = await getMerchantBalance(c.env, auth.merchant.id);

  return c.json({ 
    entries, 
    balance: { availableCents: balance, currency: "GYD" },
    limit, 
    offset 
  });
});

app.get("/v1/settlements", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  const reports = await listSettlementReports(c.env, auth.merchant.id);
  return c.json({ reports });
});

app.post("/v1/settlements/generate", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  let body: { periodStart?: string; periodEnd?: string } = {};
  try {
    body = await c.req.json();
  } catch {}

  const now = new Date();
  const periodEnd = body.periodEnd || now.toISOString();
  const periodStart = body.periodStart || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const report = await generateSettlementReport(c.env, auth.merchant.id, periodStart, periodEnd);
  return c.json(report, 201);
});

app.get("/v1/disputes", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 200);
  const offset = parseInt(c.req.query("offset") || "0");
  const status = c.req.query("status") as any;

  const disputes = await listDisputesForMerchant(c.env, auth.merchant.id, {
    limit,
    offset,
    status,
  });

  return c.json({ disputes, limit, offset });
});

app.get("/v1/disputes/:id", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  const dispute = await getDisputeForMerchant(c.env, c.req.param("id"), auth.merchant.id);
  if (!dispute) {
    return c.json(createError("not_found"), 404);
  }

  return c.json(dispute);
});

app.post("/v1/disputes/:id/evidence", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  let body: { evidenceUrl?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json(createError("invalid_request"), 400);
  }

  if (!body.evidenceUrl) {
    return c.json(createError("invalid_request", "evidenceUrl required"), 400);
  }

  const dispute = await getDisputeForMerchant(c.env, c.req.param("id"), auth.merchant.id);
  if (!dispute) {
    return c.json(createError("not_found"), 404);
  }

  const updated = await submitEvidence(c.env, dispute.id, body.evidenceUrl, auth.merchant.id);
  if (!updated) {
    return c.json(createError("not_found"), 404);
  }
  return c.json(updated);
});

app.get("/v1/audit", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 200);
  const offset = parseInt(c.req.query("offset") || "0");
  const action = c.req.query("action") as any;
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  const logs = await listAuditLogs(c.env, auth.merchant.id, {
    action,
    startDate,
    endDate,
    limit,
    offset,
  });

  return c.json({ logs, limit, offset });
});

app.get("/v1/test-cards", (c) => {
  const cards = Object.entries(TEST_CARDS).map(([number, config]) => ({
    number,
    outcome: config.outcome,
    description: config.reason ? ERROR_MESSAGES[config.reason] : "Approved",
  }));
  
  return c.json({
    testCards: cards,
    note: "Use these card numbers in sandbox mode. Any future expiry date and 3-digit CVV.",
  });
});

app.get("/orders/:id", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json(createError("authentication_required"), 401);
  }

  const order = await getOrderForMerchant(c.env, c.req.param("id"), auth.merchant.id);
  if (!order) return c.json(createError("order_not_found"), 404);
  
  return c.json(order);
});

export default app;
