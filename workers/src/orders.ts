import type { Env, Order, OrderStatus } from "./types";

function rowToOrder(row: Record<string, unknown>): Order {
  return {
    id: String(row.id),
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    description: String(row.description),
    status: String(row.status) as OrderStatus,
    paymentRef: row.payment_ref == null ? null : String(row.payment_ref),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function createOrder(
  env: Env,
  input: { amountCents: number; currency: string; description: string },
): Promise<Order> {
  const id = `ord_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const order: Order = {
    id,
    amountCents: input.amountCents,
    currency: input.currency,
    description: input.description || "GBTI payment",
    status: "pending",
    paymentRef: null,
    createdAt: now,
    updatedAt: now,
  };
  await env.DB.prepare(
    `INSERT INTO orders (id, amount_cents, currency, description, status, payment_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      order.id,
      order.amountCents,
      order.currency,
      order.description,
      order.status,
      order.paymentRef,
      order.createdAt,
      order.updatedAt,
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

export async function updateOrder(
  env: Env,
  id: string,
  patch: Partial<Pick<Order, "status" | "paymentRef" | "description">>,
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
     SET status = ?, payment_ref = ?, description = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      updated.status,
      updated.paymentRef,
      updated.description,
      updated.updatedAt,
      updated.id,
    )
    .run();
  return updated;
}

export async function listOrders(env: Env): Promise<Order[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM orders ORDER BY created_at DESC LIMIT 200`,
  ).all();
  return (result.results || []).map((row) =>
    rowToOrder(row as Record<string, unknown>),
  );
}

export type { OrderStatus };
