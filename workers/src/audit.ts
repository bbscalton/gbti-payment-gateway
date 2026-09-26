/**
 * Neuereatec Pay — Audit Log
 * Immutable audit trail for sensitive actions
 */

import type { Env, AuditLogEntry, AuditAction } from "./types";

function rowToAuditEntry(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: String(row.id),
    merchantId: row.merchant_id ? String(row.merchant_id) : null,
    action: String(row.action) as AuditAction,
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id),
    actorType: String(row.actor_type) as "merchant" | "system" | "admin",
    actorId: row.actor_id ? String(row.actor_id) : null,
    ipAddress: row.ip_address ? String(row.ip_address) : null,
    details: row.details ? String(row.details) : null,
    createdAt: String(row.created_at),
  };
}

export async function logAuditEvent(
  env: Env,
  input: {
    merchantId?: string;
    action: AuditAction;
    resourceType: string;
    resourceId: string;
    actorType: "merchant" | "system" | "admin";
    actorId?: string;
    ipAddress?: string;
    details?: Record<string, unknown>;
  }
): Promise<AuditLogEntry> {
  const id = `aud_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO audit_log (
      id, merchant_id, action, resource_type, resource_id,
      actor_type, actor_id, ip_address, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      input.merchantId || null,
      input.action,
      input.resourceType,
      input.resourceId,
      input.actorType,
      input.actorId || null,
      input.ipAddress || null,
      input.details ? JSON.stringify(input.details) : null,
      now
    )
    .run();

  return {
    id,
    merchantId: input.merchantId || null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    actorType: input.actorType,
    actorId: input.actorId || null,
    ipAddress: input.ipAddress || null,
    details: input.details ? JSON.stringify(input.details) : null,
    createdAt: now,
  };
}

export async function listAuditLogs(
  env: Env,
  options?: {
    merchantId?: string;
    action?: AuditAction;
    resourceType?: string;
    resourceId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }
): Promise<AuditLogEntry[]> {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  let query = `SELECT * FROM audit_log WHERE 1=1`;
  const params: (string | number)[] = [];

  if (options?.merchantId) {
    query += ` AND merchant_id = ?`;
    params.push(options.merchantId);
  }
  if (options?.action) {
    query += ` AND action = ?`;
    params.push(options.action);
  }
  if (options?.resourceType) {
    query += ` AND resource_type = ?`;
    params.push(options.resourceType);
  }
  if (options?.resourceId) {
    query += ` AND resource_id = ?`;
    params.push(options.resourceId);
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
    rowToAuditEntry(row as Record<string, unknown>)
  );
}
