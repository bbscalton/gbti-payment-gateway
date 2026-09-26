/**
 * Sapp — Idempotency Key Support
 * Prevents duplicate operations with cached responses
 */

import type { Env, IdempotencyRecord } from "./types";

const IDEMPOTENCY_TTL_HOURS = 24;

export async function getIdempotencyRecord(
  env: Env,
  merchantId: string,
  key: string
): Promise<IdempotencyRecord | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM idempotency_records WHERE merchant_id = ? AND key = ?`
  )
    .bind(merchantId, key)
    .first();

  if (!row) return null;

  const record: IdempotencyRecord = {
    key: String(row.key),
    merchantId: String(row.merchant_id),
    response: String(row.response),
    statusCode: Number(row.status_code),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
  };

  if (new Date(record.expiresAt) < new Date()) {
    await env.DB.prepare(
      `DELETE FROM idempotency_records WHERE merchant_id = ? AND key = ?`
    )
      .bind(merchantId, key)
      .run();
    return null;
  }

  return record;
}

export async function setIdempotencyRecord(
  env: Env,
  merchantId: string,
  key: string,
  response: string,
  statusCode: number
): Promise<IdempotencyRecord> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);

  await env.DB.prepare(
    `INSERT OR REPLACE INTO idempotency_records (
      key, merchant_id, response, status_code, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(key, merchantId, response, statusCode, now.toISOString(), expiresAt.toISOString())
    .run();

  return {
    key,
    merchantId,
    response,
    statusCode,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function cleanupExpiredRecords(env: Env): Promise<number> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `DELETE FROM idempotency_records WHERE expires_at < ?`
  )
    .bind(now)
    .run();

  return result.meta?.changes || 0;
}

export async function checkReplayProtection(
  env: Env,
  eventId: string
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT event_id FROM processed_webhook_events WHERE event_id = ?`
  )
    .bind(eventId)
    .first();

  return row !== null;
}

export async function markEventProcessed(
  env: Env,
  eventId: string
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO processed_webhook_events (event_id, processed_at) VALUES (?, ?)`
  )
    .bind(eventId, now)
    .run();
}

export async function cleanupOldProcessedEvents(
  env: Env,
  olderThanDays: number = 7
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(
    `DELETE FROM processed_webhook_events WHERE processed_at < ?`
  )
    .bind(cutoff)
    .run();

  return result.meta?.changes || 0;
}
