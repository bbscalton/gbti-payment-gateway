/**
 * Cross-merchant ownership tests (real local D1 with migrations applied).
 * Merchant B must never read, mutate, or learn about merchant A's resources:
 * other merchants' resources are reported as 404, never 403.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import app from "../index";
import { createWebhookEvent } from "../webhooks";
import { createDispute, submitEvidence, getDispute } from "../disputes";
import { getOrder } from "../orders";

const MASTER = env.MERCHANT_MASTER_KEY as string;
let ipCounter = 0;

async function call(
  method: string,
  path: string,
  opts: { key?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {
    "cf-connecting-ip": `10.9.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`,
    ...(opts.headers || {}),
  };
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`https://sapp.test${path}`, { method, headers, body }), env, ctx);
  await waitOnExecutionContext(ctx);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function newMerchant(label: string) {
  const r = await call("POST", "/v1/merchants", {
    key: MASTER,
    body: { name: `Ownership ${label}`, email: `${label}-${crypto.randomUUID()}@example.com` },
  });
  expect(r.status).toBe(201);
  return { id: r.json.merchant.id as string, key: r.json.testApiKey as string };
}

async function newOrder(key: string, amountCents = 150000) {
  const r = await call("POST", "/v1/orders", { key, body: { amountCents, currency: "GYD", description: "ownership test" } });
  expect(r.status).toBe(201);
  return r.json.id as string;
}

async function payWithTestCard(orderId: string, pan = "4111111111111111") {
  const r = await call("POST", "/mock-processor/charge", {
    headers: { accept: "application/json" },
    body: { orderId, pan, expiryMonth: "12", expiryYear: "2030", cvv: "123" },
  });
  expect(r.status).toBe(200);
  return r.json;
}

describe("cross-merchant ownership", () => {
  let A: { id: string; key: string };
  let B: { id: string; key: string };

  beforeEach(async () => {
    A = await newMerchant("a");
    B = await newMerchant("b");
  });

  describe("orders", () => {
    it("B cannot read A's order (404) via /v1/orders/:id or legacy /orders/:id", async () => {
      const orderId = await newOrder(A.key);
      expect((await call("GET", `/v1/orders/${orderId}`, { key: A.key })).status).toBe(200);
      const r = await call("GET", `/v1/orders/${orderId}`, { key: B.key });
      expect(r.status).toBe(404);
      expect(r.json.error.code).toBe("order_not_found");
      expect((await call("GET", `/orders/${orderId}`, { key: B.key })).status).toBe(404);
    });

    it("B's order list does not include A's orders", async () => {
      const orderId = await newOrder(A.key);
      const r = await call("GET", "/v1/orders", { key: B.key });
      expect(r.status).toBe(200);
      expect(r.json.orders.map((o: any) => o.id)).not.toContain(orderId);
    });

    it("B cannot pay/capture/void A's order (404) and the order is unchanged", async () => {
      const orderId = await newOrder(A.key);
      for (const action of ["pay", "capture", "void"]) {
        const r = await call("POST", `/v1/orders/${orderId}/${action}`, { key: B.key, body: {} });
        expect(r.status, action).toBe(404);
      }
      const order = await getOrder(env, orderId);
      expect(order?.status).toBe("pending");
      expect(order?.capturedCents).toBe(0);
    });
  });

  describe("refunds", () => {
    it("B cannot refund A's captured order (404); refund amounts unchanged", async () => {
      const orderId = await newOrder(A.key);
      const paid = await payWithTestCard(orderId);
      expect(paid.status).toBe("captured");
      const r = await call("POST", `/v1/orders/${orderId}/refund`, { key: B.key, body: { amountCents: 1000 } });
      expect(r.status).toBe(404);
      const order = await getOrder(env, orderId);
      expect(order?.refundedCents).toBe(0);
      expect(order?.status).toBe("captured");
    });

    it("B reusing A's refund Idempotency-Key does not receive A's cached response", async () => {
      const orderId = await newOrder(A.key);
      await payWithTestCard(orderId);
      const key = `idem-${crypto.randomUUID()}`;
      const a = await call("POST", `/v1/orders/${orderId}/refund`, { key: A.key, body: { amountCents: 1000 }, headers: { "idempotency-key": key } });
      expect(a.status).toBe(200);
      const b = await call("POST", `/v1/orders/${orderId}/refund`, { key: B.key, body: { amountCents: 1000 }, headers: { "idempotency-key": key } });
      expect(b.status).toBe(404);
      expect(JSON.stringify(b.json)).not.toContain(orderId);
    });
  });

  describe("webhooks", () => {
    it("B cannot redeliver A's webhook event: 404 (same as a non-existent event), event untouched", async () => {
      const orderId = await newOrder(A.key);
      const order = (await getOrder(env, orderId))!;
      const event = await createWebhookEvent(env, A.id, orderId, "payment.captured", order);
      await env.DB.prepare(`UPDATE webhook_events SET status = 'failed', next_attempt_at = NULL WHERE id = ?`).bind(event.id).run();

      const other = await call("POST", `/v1/webhooks/events/${event.id}/redeliver`, { key: B.key });
      const missing = await call("POST", `/v1/webhooks/events/evt_does_not_exist/redeliver`, { key: B.key });
      expect(other.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(other.json).toEqual(missing.json);

      const row = await env.DB.prepare(`SELECT status, next_attempt_at FROM webhook_events WHERE id = ?`).bind(event.id).first<any>();
      expect(row.status).toBe("failed");
      expect(row.next_attempt_at).toBeNull();

      // The owner can still redeliver it.
      const own = await call("POST", `/v1/webhooks/events/${event.id}/redeliver`, { key: A.key });
      expect(own.status).toBe(200);
      expect(own.json.event.id).toBe(event.id);
      expect(own.json.event.merchantId).toBe(A.id);
    });

    it("B's webhook event list does not include A's events", async () => {
      const orderId = await newOrder(A.key);
      const order = (await getOrder(env, orderId))!;
      const event = await createWebhookEvent(env, A.id, orderId, "payment.captured", order);
      const r = await call("GET", "/v1/webhooks/events", { key: B.key });
      expect(r.status).toBe(200);
      expect(r.json.events.map((e: any) => e.id)).not.toContain(event.id);
    });

    it("redeliver requires authentication", async () => {
      expect((await call("POST", "/v1/webhooks/events/evt_x/redeliver")).status).toBe(401);
    });
  });

  describe("disputes", () => {
    it("B cannot read A's dispute, submit evidence on it, or see it in the list", async () => {
      const orderId = await newOrder(A.key);
      const dispute = await createDispute(env, { merchantId: A.id, orderId, amountCents: 150000, currency: "GYD", reason: "fraudulent" as any });

      expect((await call("GET", `/v1/disputes/${dispute.id}`, { key: B.key })).status).toBe(404);
      const ev = await call("POST", `/v1/disputes/${dispute.id}/evidence`, { key: B.key, body: { evidenceUrl: "https://evil.example/x" } });
      expect(ev.status).toBe(404);
      const list = await call("GET", "/v1/disputes", { key: B.key });
      expect(list.json.disputes.map((d: any) => d.id)).not.toContain(dispute.id);

      // Data layer also refuses cross-merchant evidence.
      expect(await submitEvidence(env, dispute.id, "https://evil.example/y", B.id)).toBeNull();
      const after = await getDispute(env, dispute.id);
      expect(after?.status).toBe("opened");
      expect(after?.evidenceUrl ?? null).toBeNull();

      // Owner can.
      const own = await call("POST", `/v1/disputes/${dispute.id}/evidence`, { key: A.key, body: { evidenceUrl: "https://a.example/ev" } });
      expect(own.status).toBe(200);
      expect(own.json.status).toBe("under_review");
    });
  });

  describe("ledger and settlements", () => {
    it("B's ledger and balance exclude A's payments", async () => {
      const orderId = await newOrder(A.key);
      await payWithTestCard(orderId);
      const a = await call("GET", "/v1/ledger", { key: A.key });
      expect(a.json.entries.length).toBeGreaterThan(0);
      expect(a.json.balance.availableCents).toBeGreaterThan(0);
      const b = await call("GET", "/v1/ledger", { key: B.key });
      expect(b.status).toBe(200);
      expect(b.json.entries).toEqual([]);
      expect(b.json.balance.availableCents).toBe(0);
    });

    it("B's settlement report excludes A's volume and B cannot list A's reports", async () => {
      const orderId = await newOrder(A.key);
      await payWithTestCard(orderId);
      const aReport = await call("POST", "/v1/settlements/generate", { key: A.key, body: {} });
      expect(aReport.status).toBe(201);
      expect(aReport.json.grossCents).toBeGreaterThan(0);
      const bReport = await call("POST", "/v1/settlements/generate", { key: B.key, body: {} });
      expect(bReport.status).toBe(201);
      expect(bReport.json.grossCents).toBe(0);
      const bList = await call("GET", "/v1/settlements", { key: B.key });
      expect(bList.json.reports.map((r: any) => r.id)).not.toContain(aReport.json.id);
    });
  });

  describe("audit log", () => {
    it("B's audit log excludes A's entries", async () => {
      const orderId = await newOrder(A.key);
      const r = await call("GET", "/v1/audit", { key: B.key });
      expect(r.status).toBe(200);
      for (const log of r.json.logs) expect(log.merchantId).toBe(B.id);
      expect(JSON.stringify(r.json)).not.toContain(orderId);
    });
  });
});
