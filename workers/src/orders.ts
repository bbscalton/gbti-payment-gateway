import type { Env, Order, OrderStatus } from "./types";

const KEY_PREFIX = "order:";

function key(id: string): string {
  return `${KEY_PREFIX}${id}`;
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
  await env.ORDERS.put(key(id), JSON.stringify(order));
  return order;
}

export async function getOrder(env: Env, id: string): Promise<Order | null> {
  const raw = await env.ORDERS.get(key(id));
  if (!raw) return null;
  return JSON.parse(raw) as Order;
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
  await env.ORDERS.put(key(id), JSON.stringify(updated));
  return updated;
}

export async function listOrders(env: Env): Promise<Order[]> {
  const listed = await env.ORDERS.list({ prefix: KEY_PREFIX });
  const orders: Order[] = [];
  for (const entry of listed.keys) {
    const raw = await env.ORDERS.get(entry.name);
    if (raw) orders.push(JSON.parse(raw) as Order);
  }
  return orders.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export type { OrderStatus };
