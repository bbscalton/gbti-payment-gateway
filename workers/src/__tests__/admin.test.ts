import { describe, it, expect } from "vitest";
import { checkAdminAuth, timingSafeEqualStr } from "../admin";
import { createMerchant, issueLiveKey } from "../merchants";
import app from "../index";

const MASTER = "test-master-key-0123456789abcdef";

/** Minimal in-memory stand-in for the D1 `merchants` + `audit_log` tables. */
function fakeDb() {
  const merchants = new Map<string, Record<string, unknown>>();
  const audit: unknown[] = [];
  const cols = [
    "id", "name", "email", "status", "webhook_url", "webhook_secret",
    "test_api_key_hash", "live_api_key_hash", "test_api_key_prefix", "live_api_key_prefix",
    "kyb_data", "created_at", "updated_at",
  ];
  const db = {
    merchants,
    audit,
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { args = a; return stmt; },
        async run() {
          if (sql.includes("INSERT INTO merchants")) {
            const row: Record<string, unknown> = {};
            cols.forEach((c, i) => (row[c] = args[i]));
            merchants.set(String(row.id), row);
          } else if (sql.includes("INSERT INTO audit_log")) {
            audit.push(args);
          } else if (sql.startsWith("UPDATE merchants SET")) {
            const id = String(args[args.length - 1]);
            const row = merchants.get(id);
            if (row) {
              const sets = sql.slice("UPDATE merchants SET ".length, sql.indexOf(" WHERE")).split(", ");
              sets.forEach((s, i) => (row[s.split(" = ")[0].trim()] = args[i]));
            }
          }
          return { success: true };
        },
        async first() {
          if (sql.includes("FROM merchants WHERE id = ?")) return merchants.get(String(args[0])) ?? null;
          if (sql.includes("FROM audit_log")) return null;
          return null;
        },
        async all() { return { results: [] }; },
      };
      return stmt;
    },
  };
  return db;
}

function env(overrides: Record<string, unknown> = {}) {
  return { DB: fakeDb(), WEBHOOK_SECRET: "whsec_test", MERCHANT_MASTER_KEY: MASTER, ...overrides } as any;
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as any;

function post(path: string, body: unknown, auth?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  return new Request(`https://sapp.test${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("checkAdminAuth", () => {
  it("fails closed when the master key is not configured", () => {
    expect(checkAdminAuth(`Bearer ${MASTER}`, undefined)).toBe("not_configured");
    expect(checkAdminAuth(`Bearer ${MASTER}`, "")).toBe("not_configured");
  });
  it("reports a missing header", () => {
    expect(checkAdminAuth(undefined, MASTER)).toBe("missing");
    expect(checkAdminAuth("Basic abc", MASTER)).toBe("missing");
    expect(checkAdminAuth("Bearer ", MASTER)).toBe("missing");
  });
  it("rejects a wrong key", () => {
    expect(checkAdminAuth("Bearer nope", MASTER)).toBe("invalid");
    expect(checkAdminAuth(`Bearer ${MASTER}x`, MASTER)).toBe("invalid");
    expect(checkAdminAuth("Bearer sk_test_abc", MASTER)).toBe("invalid");
  });
  it("accepts the exact master key", () => {
    expect(checkAdminAuth(`Bearer ${MASTER}`, MASTER)).toBe("ok");
  });
  it("timingSafeEqualStr compares correctly", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
    expect(timingSafeEqualStr("", "a")).toBe(false);
  });
});

describe("POST /v1/merchants (admin only)", () => {
  const body = { name: "Test Shop", email: "shop@example.com" };

  it("rejects unauthenticated requests with 401", async () => {
    const res = await app.fetch(post("/v1/merchants", body), env(), ctx);
    expect(res.status).toBe(401);
  });

  it("rejects a merchant key or wrong key with 403", async () => {
    const res = await app.fetch(post("/v1/merchants", body, "Bearer sk_test_whatever"), env(), ctx);
    expect(res.status).toBe(403);
  });

  it("fails closed (503) when MERCHANT_MASTER_KEY is not set", async () => {
    const res = await app.fetch(post("/v1/merchants", body, "Bearer anything"), env({ MERCHANT_MASTER_KEY: undefined }), ctx);
    expect(res.status).toBe(503);
  });

  it("creates a merchant with ONLY a test key when called with the master key", async () => {
    const e = env();
    const res = await app.fetch(post("/v1/merchants", body, `Bearer ${MASTER}`), e, ctx);
    expect(res.status).toBe(201);
    const json: any = await res.json();
    expect(json.testApiKey).toMatch(/^sk_test_/);
    expect(json.liveApiKey).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("sk_live_");
    const row = e.DB.merchants.get(json.merchant.id);
    expect(row.live_api_key_hash).toBeNull();
    expect(row.live_api_key_prefix).toBeNull();
    expect(row.status).toBe("pending");
  });
});

describe("createMerchant", () => {
  it("never returns a live key", async () => {
    const e = env();
    const result: any = await createMerchant(e, { name: "A", email: "a@example.com" });
    expect(result.testApiKey).toMatch(/^sk_test_/);
    expect(result.liveApiKey).toBeUndefined();
  });

  it("throws if MERCHANT_MASTER_KEY is missing (no fallback)", async () => {
    await expect(
      createMerchant(env({ MERCHANT_MASTER_KEY: undefined }), { name: "A", email: "a@example.com" })
    ).rejects.toThrow(/MERCHANT_MASTER_KEY/);
  });
});

describe("live key issuance (admin only)", () => {
  it("requires admin auth", async () => {
    const res = await app.fetch(post("/v1/admin/merchants/mch_x/live-key", {}), env(), ctx);
    expect(res.status).toBe(401);
    const res2 = await app.fetch(post("/v1/admin/merchants/mch_x/live-key", {}, "Bearer wrong"), env(), ctx);
    expect(res2.status).toBe(403);
  });

  it("refuses unapproved merchants and issues sk_live_ once approved", async () => {
    const e = env();
    const { merchant } = await createMerchant(e, { name: "B", email: "b@example.com" });

    expect(await issueLiveKey(e, merchant.id)).toEqual({ error: "not_approved" });
    const denied = await app.fetch(post(`/v1/admin/merchants/${merchant.id}/live-key`, {}, `Bearer ${MASTER}`), e, ctx);
    expect(denied.status).toBe(403);

    const approve = await app.fetch(
      post(`/v1/admin/merchants/${merchant.id}/status`, { status: "approved" }, `Bearer ${MASTER}`), e, ctx
    );
    expect(approve.status).toBe(200);

    const res = await app.fetch(post(`/v1/admin/merchants/${merchant.id}/live-key`, {}, `Bearer ${MASTER}`), e, ctx);
    expect(res.status).toBe(201);
    const json: any = await res.json();
    expect(json.liveApiKey).toMatch(/^sk_live_/);
    expect(e.DB.merchants.get(merchant.id).live_api_key_hash).toBeTruthy();
  });

  it("returns 404 for an unknown merchant", async () => {
    const res = await app.fetch(post("/v1/admin/merchants/mch_missing/live-key", {}, `Bearer ${MASTER}`), env(), ctx);
    expect(res.status).toBe(404);
  });
});
