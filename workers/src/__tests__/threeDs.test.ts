/**
 * 3-D Secure challenge hardening (real local D1 with migrations applied).
 * An order must never become paid through /3ds-complete without a server-issued,
 * pending, unexpired, single-use challenge and the correct sandbox OTP.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import app from "../index";
import { getOrder } from "../orders";
import { getChallenge, SANDBOX_3DS_OTP, THREE_DS_MAX_ATTEMPTS, isCorrectSandboxOtp } from "../threeDs";
import { listAuditLogs } from "../audit";

const MASTER = env.MERCHANT_MASTER_KEY as string;
const CARD_3DS = "4000000000003220";
let ip = 0;

async function call(
  method: string,
  path: string,
  opts: { key?: string; body?: unknown; form?: Record<string, string>; json?: boolean; headers?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = { "cf-connecting-ip": `10.8.${Math.floor(ip / 250)}.${ip++ % 250}`, ...(opts.headers || {}) };
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  if (opts.json !== false) headers.accept = "application/json";
  let body: BodyInit | undefined;
  if (opts.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(opts.body); }
  if (opts.form) { headers["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(opts.form).toString(); }
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`https://sapp.test${path}`, { method, headers, body, redirect: "manual" }), env, ctx);
  await waitOnExecutionContext(ctx);
  const text = await res.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, json: parsed, text, location: res.headers.get("location") };
}

async function setup() {
  const m = await call("POST", "/v1/merchants", { key: MASTER, body: { name: "3DS test", email: `3ds-${crypto.randomUUID()}@example.com` } });
  expect(m.status).toBe(201);
  return { id: m.json.merchant.id as string, key: m.json.testApiKey as string };
}
async function newOrder(key: string) {
  const r = await call("POST", "/v1/orders", { key, body: { amountCents: 150000, currency: "GYD", description: "3ds test" } });
  expect(r.status).toBe(201);
  return r.json.id as string;
}
function charge(orderId: string, pan: string) {
  return call("POST", "/mock-processor/charge", { body: { orderId, pan, expiryMonth: "12", expiryYear: "2030", cvv: "123" } });
}
function complete(challengeId: string | undefined, code: string, orderId?: string) {
  const body: Record<string, string> = { code };
  if (challengeId !== undefined) body.challengeId = challengeId;
  if (orderId) body.orderId = orderId;
  return call("POST", "/3ds-complete", { body });
}
async function ledgerCount(orderId: string) {
  const r = await env.DB.prepare(`SELECT COUNT(*) n FROM ledger_entries WHERE order_id = ?`).bind(orderId).first<{ n: number }>();
  return Number(r?.n || 0);
}

describe("3-D Secure challenge", () => {
  let M: { id: string; key: string };
  beforeEach(async () => { M = await setup(); });

  it("the 3DS test card issues a server-side challenge; the order stays pending", async () => {
    const orderId = await newOrder(M.key);
    const r = await charge(orderId, CARD_3DS);
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("3ds_required");
    expect(r.json.challengeId).toMatch(/^3ds_[0-9a-f]{32}$/);
    expect(r.json.redirectUrl).toContain(`/3ds-challenge/${r.json.challengeId}`);
    const ch = await getChallenge(env, r.json.challengeId);
    expect(ch?.status).toBe("pending");
    expect(ch?.orderId).toBe(orderId);
    expect(new Date(ch!.expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    expect(new Date(ch!.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    const order = await getOrder(env, orderId);
    expect(order?.status).toBe("pending");
    expect(order?.threeDsStatus).toBe("challenge_required");
  });

  it("an order that was never challenged cannot be completed via /3ds-complete", async () => {
    const orderId = await newOrder(M.key);
    for (const r of [
      await complete(undefined, SANDBOX_3DS_OTP, orderId),            // old-style: orderId + code
      await complete("", SANDBOX_3DS_OTP, orderId),
      await complete("3ds_" + "0".repeat(32), SANDBOX_3DS_OTP, orderId), // well-formed but unknown
      await complete("pay_abcdef0123456789", SANDBOX_3DS_OTP, orderId),  // legacy paymentRef
    ]) {
      expect(r.status).toBe(400);
    }
    // Legacy HTML form post as well.
    const form = await call("POST", "/3ds-complete", { form: { orderId, code: "654321", paymentRef: "pay_x" }, json: false });
    expect(form.status).toBe(400);
    const order = await getOrder(env, orderId);
    expect(order?.status).toBe("pending");
    expect(await ledgerCount(orderId)).toBe(0);
  });

  it("a challenge cannot be used for a different order", async () => {
    const a = await newOrder(M.key);
    const b = await newOrder(M.key);
    const ch = (await charge(a, CARD_3DS)).json.challengeId;
    const r = await complete(ch, SANDBOX_3DS_OTP, b);
    expect(r.status).toBe(400);
    expect((await getOrder(env, a))?.status).toBe("pending");
    expect((await getOrder(env, b))?.status).toBe("pending");
  });

  it("a wrong code fails without paying; the correct code then captures", async () => {
    const orderId = await newOrder(M.key);
    const ch = (await charge(orderId, CARD_3DS)).json.challengeId;
    const wrong = await complete(ch, "000000");
    expect(wrong.status).toBe(400);
    expect(wrong.json.ok).toBe(false);
    expect(wrong.json.attemptsRemaining).toBe(THREE_DS_MAX_ATTEMPTS - 1);
    expect((await getOrder(env, orderId))?.status).toBe("pending");

    const ok = await complete(ch, SANDBOX_3DS_OTP);
    expect(ok.status).toBe(200);
    expect(ok.json.ok).toBe(true);
    expect(ok.json.status).toBe("captured");
    const order = await getOrder(env, orderId);
    expect(order?.status).toBe("captured");
    expect(order?.threeDsStatus).toBe("authenticated");
    expect((await getChallenge(env, ch))?.status).toBe("succeeded");
    expect(await ledgerCount(orderId)).toBe(2); // payment + fee
  });

  it("a challenge is single-use: reuse after success fails and does not double-book", async () => {
    const orderId = await newOrder(M.key);
    const ch = (await charge(orderId, CARD_3DS)).json.challengeId;
    expect((await complete(ch, SANDBOX_3DS_OTP)).status).toBe(200);
    const again = await complete(ch, SANDBOX_3DS_OTP);
    expect(again.status).toBe(409);
    expect(await ledgerCount(orderId)).toBe(2);
  });

  it("concurrent correct submissions capture exactly once", async () => {
    const orderId = await newOrder(M.key);
    const ch = (await charge(orderId, CARD_3DS)).json.challengeId;
    const results = await Promise.all([complete(ch, SANDBOX_3DS_OTP), complete(ch, SANDBOX_3DS_OTP), complete(ch, SANDBOX_3DS_OTP)]);
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    expect(await ledgerCount(orderId)).toBe(2);
  });

  it(`after ${THREE_DS_MAX_ATTEMPTS} wrong codes the payment fails and the correct code no longer works`, async () => {
    const orderId = await newOrder(M.key);
    const ch = (await charge(orderId, CARD_3DS)).json.challengeId;
    for (let i = 1; i <= THREE_DS_MAX_ATTEMPTS; i++) {
      const r = await complete(ch, "111111");
      expect(r.status).toBe(400);
      expect(r.json.attemptsRemaining).toBe(THREE_DS_MAX_ATTEMPTS - i);
    }
    const order = await getOrder(env, orderId);
    expect(order?.status).toBe("failed");
    expect(order?.threeDsStatus).toBe("failed");
    expect((await getChallenge(env, ch))?.status).toBe("failed");
    const late = await complete(ch, SANDBOX_3DS_OTP);
    expect(late.status).toBe(409);
    expect((await getOrder(env, orderId))?.status).toBe("failed");
    expect(await ledgerCount(orderId)).toBe(0);
  });

  it("an expired challenge cannot be completed and fails the payment", async () => {
    const orderId = await newOrder(M.key);
    const ch = (await charge(orderId, CARD_3DS)).json.challengeId;
    await env.DB.prepare(`UPDATE three_ds_challenges SET expires_at = ? WHERE id = ?`).bind(new Date(Date.now() - 1000).toISOString(), ch).run();
    const r = await complete(ch, SANDBOX_3DS_OTP);
    expect(r.status).toBe(410);
    expect((await getOrder(env, orderId))?.status).toBe("failed");
    expect((await getChallenge(env, ch))?.status).toBe("expired");
    expect(await ledgerCount(orderId)).toBe(0);
  });

  it("a newer challenge supersedes an older one for the same order", async () => {
    const orderId = await newOrder(M.key);
    const first = (await charge(orderId, CARD_3DS)).json.challengeId;
    const second = (await charge(orderId, CARD_3DS)).json.challengeId;
    expect(first).not.toBe(second);
    expect((await complete(first, SANDBOX_3DS_OTP)).status).toBe(409);
    expect((await getOrder(env, orderId))?.status).toBe("pending");
    expect((await complete(second, SANDBOX_3DS_OTP)).status).toBe(200);
  });

  it("a challenge cannot complete an order that is no longer awaiting 3DS", async () => {
    const orderId = await newOrder(M.key);
    const ch = (await charge(orderId, CARD_3DS)).json.challengeId;
    const paid = await charge(orderId, "4111111111111111"); // customer switches to another card
    expect(paid.json.status).toBe("captured");
    const r = await complete(ch, SANDBOX_3DS_OTP);
    expect(r.status).toBe(409);
    expect(await ledgerCount(orderId)).toBe(2); // only the 4111 capture
  });

  it("only a pending order can enter 3DS", async () => {
    const orderId = await newOrder(M.key);
    await charge(orderId, "4000000000000002"); // declined -> failed
    const r = await charge(orderId, CARD_3DS);
    expect(r.status).toBe(409);
  });

  it("challenge page shows the sandbox OTP and posts the challenge id; HTML flow redirects", async () => {
    const orderId = await newOrder(M.key);
    const ch = (await charge(orderId, CARD_3DS)).json.challengeId;
    const page = await call("GET", `/3ds-challenge/${ch}`, { json: false });
    expect(page.status).toBe(200);
    expect(page.text).toContain(SANDBOX_3DS_OTP);
    expect(page.text).toContain(`name="challengeId" value="${ch}"`);
    expect(page.text).toContain("Attempts remaining: 3");
    expect((await call("GET", `/3ds-challenge/3ds_${"f".repeat(32)}`, { json: false })).status).toBe(404);

    const wrong = await call("POST", "/3ds-complete", { form: { challengeId: ch, orderId, code: "999999" }, json: false });
    expect(wrong.status).toBe(303);
    expect(wrong.location).toContain(`/3ds-challenge/${ch}?error=invalid_code`);
    const ok = await call("POST", "/3ds-complete", { form: { challengeId: ch, orderId, code: SANDBOX_3DS_OTP }, json: false });
    expect(ok.status).toBe(303);
    expect(ok.location).toContain(`/checkout/${orderId}/result`);
    expect((await getOrder(env, orderId))?.status).toBe("captured");
  });

  it("the normal 4111 card path still captures", async () => {
    const orderId = await newOrder(M.key);
    const r = await charge(orderId, "4111111111111111");
    expect(r.json.status).toBe("captured");
    expect((await getOrder(env, orderId))?.threeDsStatus).not.toBe("challenge_required");
  });

  it("isCorrectSandboxOtp only accepts the documented code", () => {
    expect(isCorrectSandboxOtp("123456")).toBe(true);
    expect(isCorrectSandboxOtp(" 123456 ")).toBe(true);
    for (const bad of ["", "12345", "1234567", "654321", "000000", undefined, null]) {
      expect(isCorrectSandboxOtp(bad as any)).toBe(false);
    }
  });
});

describe("refund idempotency is scoped by order", () => {
  it("reusing a key on a different order refunds that order instead of replaying the first response", async () => {
    const M = await setup();
    const o1 = await newOrder(M.key);
    const o2 = await newOrder(M.key);
    await charge(o1, "4111111111111111");
    await charge(o2, "4111111111111111");
    const key = `idem-${crypto.randomUUID()}`;
    const r1 = await call("POST", `/v1/orders/${o1}/refund`, { key: M.key, body: { amountCents: 1000 }, headers: { "idempotency-key": key } });
    expect(r1.status).toBe(200);
    expect(r1.json.order.id).toBe(o1);
    const r2 = await call("POST", `/v1/orders/${o2}/refund`, { key: M.key, body: { amountCents: 2000 }, headers: { "idempotency-key": key } });
    expect(r2.status).toBe(200);
    expect(r2.json.order.id).toBe(o2);
    expect((await getOrder(env, o2))?.refundedCents).toBe(2000);
    // Same key on the same order still replays (no double refund).
    const r1b = await call("POST", `/v1/orders/${o1}/refund`, { key: M.key, body: { amountCents: 1000 }, headers: { "idempotency-key": key } });
    expect(r1b.json.order.id).toBe(o1);
    expect((await getOrder(env, o1))?.refundedCents).toBe(1000);
  });
});

describe("audit log lookup requires a merchant id", () => {
  it("throws without a merchant id", async () => {
    await expect(listAuditLogs(env, "" as any)).rejects.toThrow(/merchantId/);
    await expect(listAuditLogs(env, undefined as any)).rejects.toThrow(/merchantId/);
  });
  it("returns only that merchant's rows", async () => {
    const A = await setup();
    const B = await setup();
    await newOrder(A.key);
    const logs = await listAuditLogs(env, B.id);
    for (const l of logs) expect(l.merchantId).toBe(B.id);
  });
});
