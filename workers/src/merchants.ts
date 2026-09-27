/**
 * Sapp — Merchant Management
 * API key authentication and merchant CRUD operations
 */

import type { Env, Merchant, MerchantKybData, MerchantStatus } from "./types";

const API_KEY_PREFIX_LENGTH = 8;

function rowToMerchant(row: Record<string, unknown>): Merchant {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    status: String(row.status) as MerchantStatus,
    webhookUrl: row.webhook_url ? String(row.webhook_url) : null,
    webhookSecret: row.webhook_secret ? String(row.webhook_secret) : null,
    testApiKeyHash: row.test_api_key_hash ? String(row.test_api_key_hash) : null,
    liveApiKeyHash: row.live_api_key_hash ? String(row.live_api_key_hash) : null,
    testApiKeyPrefix: row.test_api_key_prefix ? String(row.test_api_key_prefix) : null,
    liveApiKeyPrefix: row.live_api_key_prefix ? String(row.live_api_key_prefix) : null,
    kybData: row.kyb_data ? JSON.parse(String(row.kyb_data)) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function hashApiKey(apiKey: string, masterKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(masterKey);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(apiKey));
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function requireMasterKey(env: Env): string {
  const key = env.MERCHANT_MASTER_KEY;
  if (!key) throw new Error("MERCHANT_MASTER_KEY is not configured");
  return key;
}

function generateApiKey(prefix: "sk_test_" | "sk_live_"): string {
  const randomPart = crypto.randomUUID().replace(/-/g, "") + 
                     crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${prefix}${randomPart}`;
}

/**
 * Create a merchant. Sandbox onboarding issues ONLY a test key (sk_test_).
 * Live keys are never handed out at signup; they can only be issued by an
 * authenticated admin action (see issueLiveKey / POST /v1/admin/merchants/:id/live-key).
 */
export async function createMerchant(
  env: Env,
  input: {
    name: string;
    email: string;
    webhookUrl?: string;
    kybData?: MerchantKybData;
  }
): Promise<{ merchant: Merchant; testApiKey: string }> {
  const id = `mch_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const testApiKey = generateApiKey("sk_test_");

  const masterKey = requireMasterKey(env);
  const testKeyHash = await hashApiKey(testApiKey, masterKey);
  const testKeyPrefix = testApiKey.slice(0, API_KEY_PREFIX_LENGTH);

  const webhookSecret = `whsec_${crypto.randomUUID().replace(/-/g, "")}`;

  await env.DB.prepare(
    `INSERT INTO merchants (
      id, name, email, status, webhook_url, webhook_secret,
      test_api_key_hash, live_api_key_hash, test_api_key_prefix, live_api_key_prefix,
      kyb_data, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      input.name,
      input.email,
      "pending",
      input.webhookUrl || null,
      webhookSecret,
      testKeyHash,
      null,
      testKeyPrefix,
      null,
      input.kybData ? JSON.stringify(input.kybData) : null,
      now,
      now
    )
    .run();

  const merchant = await getMerchant(env, id);
  if (!merchant) throw new Error("Failed to create merchant");

  return { merchant, testApiKey };
}

/**
 * Admin-only: issue (or rotate) a live key. Only allowed for approved merchants.
 */
export async function issueLiveKey(
  env: Env,
  merchantId: string
): Promise<{ apiKey: string } | { error: "merchant_not_found" | "not_approved" }> {
  const merchant = await getMerchant(env, merchantId);
  if (!merchant) return { error: "merchant_not_found" };
  if (merchant.status !== "approved") return { error: "not_approved" };
  const result = await rotateApiKeys(env, merchantId, "live");
  if (!result) return { error: "merchant_not_found" };
  return result;
}

export async function getMerchant(env: Env, id: string): Promise<Merchant | null> {
  const row = await env.DB.prepare(`SELECT * FROM merchants WHERE id = ?`)
    .bind(id)
    .first();
  if (!row) return null;
  return rowToMerchant(row as Record<string, unknown>);
}

export async function getMerchantByEmail(env: Env, email: string): Promise<Merchant | null> {
  const row = await env.DB.prepare(`SELECT * FROM merchants WHERE email = ?`)
    .bind(email)
    .first();
  if (!row) return null;
  return rowToMerchant(row as Record<string, unknown>);
}

export async function authenticateMerchant(
  env: Env,
  apiKey: string
): Promise<{ merchant: Merchant; isTestMode: boolean } | null> {
  if (!apiKey) return null;
  
  const isTestKey = apiKey.startsWith("sk_test_");
  const isLiveKey = apiKey.startsWith("sk_live_");
  
  if (!isTestKey && !isLiveKey) return null;

  // Fail closed: without the master key no API key can be verified.
  if (!env.MERCHANT_MASTER_KEY) return null;
  const masterKey = env.MERCHANT_MASTER_KEY;
  const keyHash = await hashApiKey(apiKey, masterKey);
  const keyPrefix = apiKey.slice(0, API_KEY_PREFIX_LENGTH);
  
  const column = isTestKey ? "test_api_key_hash" : "live_api_key_hash";
  const prefixColumn = isTestKey ? "test_api_key_prefix" : "live_api_key_prefix";
  
  const row = await env.DB.prepare(
    `SELECT * FROM merchants WHERE ${prefixColumn} = ? AND ${column} = ?`
  )
    .bind(keyPrefix, keyHash)
    .first();
  
  if (!row) return null;
  
  const merchant = rowToMerchant(row as Record<string, unknown>);
  return { merchant, isTestMode: isTestKey };
}

export async function updateMerchant(
  env: Env,
  id: string,
  patch: Partial<Pick<Merchant, "name" | "webhookUrl" | "status" | "kybData">>
): Promise<Merchant | null> {
  const merchant = await getMerchant(env, id);
  if (!merchant) return null;

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (patch.name !== undefined) {
    updates.push("name = ?");
    values.push(patch.name);
  }
  if (patch.webhookUrl !== undefined) {
    updates.push("webhook_url = ?");
    values.push(patch.webhookUrl);
  }
  if (patch.status !== undefined) {
    updates.push("status = ?");
    values.push(patch.status);
  }
  if (patch.kybData !== undefined) {
    updates.push("kyb_data = ?");
    values.push(JSON.stringify(patch.kybData));
  }

  if (updates.length === 0) return merchant;

  updates.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  await env.DB.prepare(
    `UPDATE merchants SET ${updates.join(", ")} WHERE id = ?`
  )
    .bind(...values)
    .run();

  return getMerchant(env, id);
}

export async function rotateApiKeys(
  env: Env,
  merchantId: string,
  keyType: "test" | "live"
): Promise<{ apiKey: string } | null> {
  const merchant = await getMerchant(env, merchantId);
  if (!merchant) return null;

  const prefix = keyType === "test" ? "sk_test_" : "sk_live_";
  const newApiKey = generateApiKey(prefix);
  
  const masterKey = requireMasterKey(env);
  const newKeyHash = await hashApiKey(newApiKey, masterKey);
  const newKeyPrefix = newApiKey.slice(0, API_KEY_PREFIX_LENGTH);

  const hashColumn = keyType === "test" ? "test_api_key_hash" : "live_api_key_hash";
  const prefixColumn = keyType === "test" ? "test_api_key_prefix" : "live_api_key_prefix";

  await env.DB.prepare(
    `UPDATE merchants SET ${hashColumn} = ?, ${prefixColumn} = ?, updated_at = ? WHERE id = ?`
  )
    .bind(newKeyHash, newKeyPrefix, new Date().toISOString(), merchantId)
    .run();

  return { apiKey: newApiKey };
}

export async function listMerchants(
  env: Env,
  options?: { status?: MerchantStatus; limit?: number; offset?: number }
): Promise<Merchant[]> {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;
  
  let query = `SELECT * FROM merchants`;
  const params: (string | number)[] = [];
  
  if (options?.status) {
    query += ` WHERE status = ?`;
    params.push(options.status);
  }
  
  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const result = await env.DB.prepare(query).bind(...params).all();
  return (result.results || []).map((row) =>
    rowToMerchant(row as Record<string, unknown>)
  );
}
