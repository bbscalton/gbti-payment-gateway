/**
 * Sapp — Order Management
 * Payment state machine with multi-tenant support
 * NEVER stores PAN, CVV, or expiry
 */

import type { Env, Order, OrderStatus, ThreeDsStatus } from "./types";

function rowToOrder(row: Record<string, unknown>): Order {
  return {
    id: String(row.id),
    merchantId: row.merchant_id ? String(row.merchant_id) : "",
    amountCents: Number(row.amount_cents),
    capturedCents: Number(row.captured_cents || 0),
    refundedCents: Number(row.refunded_cents || 0),
    currency: String(row.currency),
    description: String(row.description),
    status: String(row.status) as OrderStatus,
    paymentRef: row.payment_ref == null ? null : String(row.payment_ref),
    authorizationRef: row.authorization_ref == null ? null : String(row.authorization_ref),
    threeDsStatus: row.three_ds_status == null ? null : String(row.three_ds_status) as ThreeDsStatus,
    idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
    metadata: row.metadata ? JSON.parse(String(row.metadata)) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["authorized", "captured", "failed"],
  authorized: ["captured", "partially_captured", "voided", "failed"],
  captured: ["refunded", "partially_refunded", "disputed"],
  partially_captured: ["captured", "voided", "refunded", "partially_refunded"],
  voided: [],
  failed: [],
  refunded: [],
  partially_refunded: ["refunded", "partially_refunded", "disputed"],
  disputed: ["chargeback_won", "chargeback_lost"],
  chargeback_won: [],
  chargeback_lost: [],
};

export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export async function createOrder(
  env: Env,
  input: {
    merchantId: string;
    amountCents: number;
    currency: string;
    description: string;
    idempotencyKey?: string;
    metadata?: Record<string, string>;
  }
): Promise<Order> {
  const id = `ord_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const order: Order = {
    id,
    merchantId: input.merchantId,
    amountCents: input.amountCents,
    capturedCents: 0,
    refundedCents: 0,
    currency: input.currency,
    description: input.description || "Payment",
    status: "pending",
    paymentRef: null,
    authorizationRef: null,
    threeDsStatus: null,
    idempotencyKey: input.idempotencyKey || null,
    metadata: input.metadata || null,
    createdAt: now,
    updatedAt: now,
  };
  await env.DB.prepare(
    `INSERT INTO orders (
      id, merchant_id, amount_cents, captured_cents, refunded_cents,
      currency, description, status, payment_ref, authorization_ref,
      three_ds_status, idempotency_key, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      order.id,
      order.merchantId,
      order.amountCents,
      order.capturedCents,
      order.refundedCents,
      order.currency,
      order.description,
      order.status,
      order.paymentRef,
      order.authorizationRef,
      order.threeDsStatus,
      order.idempotencyKey,
      order.metadata ? JSON.stringify(order.metadata) : null,
      order.createdAt,
      order.updatedAt
    )
    .run();
  return order;
}

export async function getOrder(env: Env, id: string): Promise<Order | null> {
  const row = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?`)
    .bind(id)
    .first();
  if (!row) return null;
  return rowToOrder(row as Record<string, unknown>);
}

export async function getOrderForMerchant(
  env: Env,
  id: string,
  merchantId: string
): Promise<Order | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM orders WHERE id = ? AND merchant_id = ?`
  )
    .bind(id, merchantId)
    .first();
  if (!row) return null;
  return rowToOrder(row as Record<string, unknown>);
}

export async function updateOrder(
  env: Env,
  id: string,
  patch: Partial<Pick<Order, 
    "status" | "paymentRef" | "authorizationRef" | "capturedCents" | 
    "refundedCents" | "threeDsStatus" | "description" | "metadata"
  >>
): Promise<Order | null> {
  const order = await getOrder(env, id);
  if (!order) return null;
  
  const updated: Order = {
    ...order,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  
  await env.DB.prepare(
    `UPDATE orders
     SET status = ?, payment_ref = ?, authorization_ref = ?, captured_cents = ?,
         refunded_cents = ?, three_ds_status = ?, description = ?, metadata = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      updated.status,
      updated.paymentRef,
      updated.authorizationRef,
      updated.capturedCents,
      updated.refundedCents,
      updated.threeDsStatus,
      updated.description,
      updated.metadata ? JSON.stringify(updated.metadata) : null,
      updated.updatedAt,
      updated.id
    )
    .run();
  return updated;
}

export async function listOrdersForMerchant(
  env: Env,
  merchantId: string,
  options?: { 
    status?: OrderStatus; 
    limit?: number; 
    offset?: number;
    startDate?: string;
    endDate?: string;
  }
): Promise<Order[]> {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;
  
  let query = `SELECT * FROM orders WHERE merchant_id = ?`;
  const params: (string | number)[] = [merchantId];
  
  if (options?.status) {
    query += ` AND status = ?`;
    params.push(options.status);
  }
  if (options?.startDate) {
    query += ` AND created_at >= ?`;
    params.push(options.startDate);
  }
  if (options?.endDate) {
    query += ` AND created_at <= ?`;
    params.push(options.endDate);
  }
  
  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const result = await env.DB.prepare(query).bind(...params).all();
  return (result.results || []).map((row) =>
    rowToOrder(row as Record<string, unknown>)
  );
}

export async function authorize(
  env: Env,
  orderId: string,
  authorizationRef: string,
  threeDsStatus?: ThreeDsStatus
): Promise<Order | null> {
  const order = await getOrder(env, orderId);
  if (!order) return null;
  if (!isValidTransition(order.status, "authorized")) return null;
  
  return updateOrder(env, orderId, {
    status: "authorized",
    authorizationRef,
    threeDsStatus: threeDsStatus || "not_required",
  });
}

export async function capture(
  env: Env,
  orderId: string,
  amountCents: number,
  paymentRef: string
): Promise<Order | null> {
  const order = await getOrder(env, orderId);
  if (!order) return null;
  
  const newCaptured = order.capturedCents + amountCents;
  if (newCaptured > order.amountCents) return null;
  
  const newStatus: OrderStatus = newCaptured === order.amountCents 
    ? "captured" 
    : "partially_captured";
  
  if (!isValidTransition(order.status, newStatus)) return null;
  
  return updateOrder(env, orderId, {
    status: newStatus,
    capturedCents: newCaptured,
    paymentRef,
  });
}

export async function voidOrder(
  env: Env,
  orderId: string
): Promise<Order | null> {
  const order = await getOrder(env, orderId);
  if (!order) return null;
  if (!isValidTransition(order.status, "voided")) return null;
  
  return updateOrder(env, orderId, { status: "voided" });
}

export async function refund(
  env: Env,
  orderId: string,
  amountCents: number
): Promise<Order | null> {
  const order = await getOrder(env, orderId);
  if (!order) return null;
  
  const maxRefundable = order.capturedCents - order.refundedCents;
  if (amountCents > maxRefundable) return null;
  
  const newRefunded = order.refundedCents + amountCents;
  const newStatus: OrderStatus = newRefunded === order.capturedCents
    ? "refunded"
    : "partially_refunded";
  
  if (!isValidTransition(order.status, newStatus)) return null;
  
  return updateOrder(env, orderId, {
    status: newStatus,
    refundedCents: newRefunded,
  });
}

export async function findByIdempotencyKey(
  env: Env,
  merchantId: string,
  idempotencyKey: string
): Promise<Order | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM orders WHERE merchant_id = ? AND idempotency_key = ?`
  )
    .bind(merchantId, idempotencyKey)
    .first();
  if (!row) return null;
  return rowToOrder(row as Record<string, unknown>);
}

export type { OrderStatus };
