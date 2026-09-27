/**
 * Sapp — Outbound Merchant Webhooks
 * Signed webhook delivery with retries and event logging
 */

import type { 
  Env, 
  Order, 
  WebhookEvent, 
  WebhookEventType, 
  WebhookEventStatus,
  Merchant 
} from "./types";
import { signWebhookPayload } from "./mockProcessor";

const MAX_RETRIES = 8;
const RETRY_DELAYS_MS = [
  0,
  60_000,
  300_000,
  900_000,
  3600_000,
  14400_000,
  43200_000,
  86400_000,
];

function rowToWebhookEvent(row: Record<string, unknown>): WebhookEvent {
  return {
    id: String(row.id),
    merchantId: String(row.merchant_id),
    orderId: String(row.order_id),
    eventType: String(row.event_type) as WebhookEventType,
    payload: String(row.payload),
    status: String(row.status) as WebhookEventStatus,
    attempts: Number(row.attempts),
    lastAttemptAt: row.last_attempt_at ? String(row.last_attempt_at) : null,
    nextAttemptAt: row.next_attempt_at ? String(row.next_attempt_at) : null,
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    createdAt: String(row.created_at),
  };
}

export async function createWebhookEvent(
  env: Env,
  merchantId: string,
  orderId: string,
  eventType: WebhookEventType,
  order: Order
): Promise<WebhookEvent> {
  const id = `evt_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  
  const payload = JSON.stringify({
    id,
    type: eventType,
    created: now,
    data: {
      object: {
        id: order.id,
        merchantId: order.merchantId,
        amountCents: order.amountCents,
        capturedCents: order.capturedCents,
        refundedCents: order.refundedCents,
        currency: order.currency,
        description: order.description,
        status: order.status,
        paymentRef: order.paymentRef,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
    },
  });

  await env.DB.prepare(
    `INSERT INTO webhook_events (
      id, merchant_id, order_id, event_type, payload, status,
      attempts, next_attempt_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, merchantId, orderId, eventType, payload, "pending", 0, now, now)
    .run();

  const event = await getWebhookEvent(env, id);
  if (!event) throw new Error("Failed to create webhook event");
  return event;
}

export async function getWebhookEvent(env: Env, id: string): Promise<WebhookEvent | null> {
  const row = await env.DB.prepare(`SELECT * FROM webhook_events WHERE id = ?`)
    .bind(id)
    .first();
  if (!row) return null;
  return rowToWebhookEvent(row as Record<string, unknown>);
}

export async function listWebhookEventsForMerchant(
  env: Env,
  merchantId: string,
  options?: { status?: WebhookEventStatus; limit?: number; offset?: number }
): Promise<WebhookEvent[]> {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;
  
  let query = `SELECT * FROM webhook_events WHERE merchant_id = ?`;
  const params: (string | number)[] = [merchantId];
  
  if (options?.status) {
    query += ` AND status = ?`;
    params.push(options.status);
  }
  
  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const result = await env.DB.prepare(query).bind(...params).all();
  return (result.results || []).map((row) =>
    rowToWebhookEvent(row as Record<string, unknown>)
  );
}

export async function deliverWebhook(
  env: Env,
  event: WebhookEvent,
  merchant: Merchant
): Promise<boolean> {
  if (!merchant.webhookUrl || !merchant.webhookSecret) {
    await markEventFailed(env, event.id, "No webhook URL or secret configured");
    return false;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signWebhookPayload(event.payload, merchant.webhookSecret, timestamp);
  
  try {
    const response = await fetch(merchant.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sapp-Signature": signature,
        "X-Sapp-Event-Id": event.id,
        "X-Sapp-Event-Type": event.eventType,
        "User-Agent": "Sapp-Webhook/1.0",
      },
      body: event.payload,
    });

    const now = new Date().toISOString();
    
    if (response.ok) {
      await env.DB.prepare(
        `UPDATE webhook_events 
         SET status = ?, attempts = attempts + 1, last_attempt_at = ?, delivered_at = ?, next_attempt_at = NULL
         WHERE id = ?`
      )
        .bind("delivered", now, now, event.id)
        .run();
      return true;
    }

    await scheduleRetry(env, event);
    return false;
  } catch (error) {
    await scheduleRetry(env, event);
    return false;
  }
}

async function scheduleRetry(env: Env, event: WebhookEvent): Promise<void> {
  const newAttempts = event.attempts + 1;
  const now = new Date();
  
  if (newAttempts >= MAX_RETRIES) {
    await env.DB.prepare(
      `UPDATE webhook_events 
       SET status = ?, attempts = ?, last_attempt_at = ?, next_attempt_at = NULL
       WHERE id = ?`
    )
      .bind("exhausted", newAttempts, now.toISOString(), event.id)
      .run();
    return;
  }

  const delayMs = RETRY_DELAYS_MS[newAttempts] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
  const nextAttempt = new Date(now.getTime() + delayMs).toISOString();

  await env.DB.prepare(
    `UPDATE webhook_events 
     SET status = ?, attempts = ?, last_attempt_at = ?, next_attempt_at = ?
     WHERE id = ?`
  )
    .bind("pending", newAttempts, now.toISOString(), nextAttempt, event.id)
    .run();
}

async function markEventFailed(env: Env, eventId: string, reason: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE webhook_events SET status = ?, last_attempt_at = ? WHERE id = ?`
  )
    .bind("failed", new Date().toISOString(), eventId)
    .run();
}

export async function getPendingWebhooks(
  env: Env,
  limit: number = 100
): Promise<WebhookEvent[]> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `SELECT * FROM webhook_events 
     WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY created_at ASC
     LIMIT ?`
  )
    .bind(now, limit)
    .all();
  return (result.results || []).map((row) =>
    rowToWebhookEvent(row as Record<string, unknown>)
  );
}

/** Fetch a webhook event only if it belongs to the given merchant. */
export async function getWebhookEventForMerchant(
  env: Env,
  id: string,
  merchantId: string
): Promise<WebhookEvent | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM webhook_events WHERE id = ? AND merchant_id = ?`
  )
    .bind(id, merchantId)
    .first();
  if (!row) return null;
  return rowToWebhookEvent(row as Record<string, unknown>);
}

/**
 * Re-queue a webhook event for delivery. Scoped to the owning merchant:
 * returns null (-> 404) when the event does not exist OR belongs to another
 * merchant, so callers cannot probe for other merchants' event IDs.
 */
export async function redeliverWebhook(
  env: Env,
  merchantId: string,
  eventId: string
): Promise<WebhookEvent | null> {
  const event = await getWebhookEventForMerchant(env, eventId, merchantId);
  if (!event) return null;

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE webhook_events SET status = ?, next_attempt_at = ? WHERE id = ? AND merchant_id = ?`
  )
    .bind("pending", now, eventId, merchantId)
    .run();

  return getWebhookEventForMerchant(env, eventId, merchantId);
}
