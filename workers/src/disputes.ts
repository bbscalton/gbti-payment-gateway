/**
 * Sapp — Disputes and Chargebacks
 * Mock dispute management for sandbox testing
 */

import type { 
  Env, 
  Dispute, 
  DisputeStatus, 
  DisputeReason 
} from "./types";

function rowToDispute(row: Record<string, unknown>): Dispute {
  return {
    id: String(row.id),
    merchantId: String(row.merchant_id),
    orderId: String(row.order_id),
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    reason: String(row.reason) as DisputeReason,
    status: String(row.status) as DisputeStatus,
    evidenceUrl: row.evidence_url ? String(row.evidence_url) : null,
    evidenceDueBy: row.evidence_due_by ? String(row.evidence_due_by) : null,
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function createDispute(
  env: Env,
  input: {
    merchantId: string;
    orderId: string;
    amountCents: number;
    currency: string;
    reason: DisputeReason;
  }
): Promise<Dispute> {
  const id = `dsp_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();
  const evidenceDueBy = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO disputes (
      id, merchant_id, order_id, amount_cents, currency, reason,
      status, evidence_due_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      input.merchantId,
      input.orderId,
      input.amountCents,
      input.currency,
      input.reason,
      "opened",
      evidenceDueBy,
      now.toISOString(),
      now.toISOString()
    )
    .run();

  const dispute = await getDispute(env, id);
  if (!dispute) throw new Error("Failed to create dispute");
  return dispute;
}

export async function getDispute(env: Env, id: string): Promise<Dispute | null> {
  const row = await env.DB.prepare(`SELECT * FROM disputes WHERE id = ?`)
    .bind(id)
    .first();
  if (!row) return null;
  return rowToDispute(row as Record<string, unknown>);
}

export async function getDisputeForMerchant(
  env: Env,
  id: string,
  merchantId: string
): Promise<Dispute | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM disputes WHERE id = ? AND merchant_id = ?`
  )
    .bind(id, merchantId)
    .first();
  if (!row) return null;
  return rowToDispute(row as Record<string, unknown>);
}

export async function getDisputeByOrder(
  env: Env,
  orderId: string
): Promise<Dispute | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM disputes WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`
  )
    .bind(orderId)
    .first();
  if (!row) return null;
  return rowToDispute(row as Record<string, unknown>);
}

export async function updateDispute(
  env: Env,
  id: string,
  patch: Partial<Pick<Dispute, "status" | "evidenceUrl" | "resolvedAt">>
): Promise<Dispute | null> {
  const dispute = await getDispute(env, id);
  if (!dispute) return null;

  const updated = {
    ...dispute,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  await env.DB.prepare(
    `UPDATE disputes
     SET status = ?, evidence_url = ?, resolved_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      updated.status,
      updated.evidenceUrl,
      updated.resolvedAt,
      updated.updatedAt,
      updated.id
    )
    .run();

  return updated;
}

export async function submitEvidence(
  env: Env,
  disputeId: string,
  evidenceUrl: string,
  merchantId: string
): Promise<Dispute | null> {
  // Ownership check inside the data layer too (defense in depth).
  const owned = await getDisputeForMerchant(env, disputeId, merchantId);
  if (!owned) return null;
  return updateDispute(env, disputeId, {
    status: "under_review",
    evidenceUrl,
  });
}

export async function resolveDispute(
  env: Env,
  disputeId: string,
  outcome: "won" | "lost"
): Promise<Dispute | null> {
  return updateDispute(env, disputeId, {
    status: outcome,
    resolvedAt: new Date().toISOString(),
  });
}

export async function listDisputesForMerchant(
  env: Env,
  merchantId: string,
  options?: { 
    status?: DisputeStatus; 
    limit?: number; 
    offset?: number 
  }
): Promise<Dispute[]> {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  let query = `SELECT * FROM disputes WHERE merchant_id = ?`;
  const params: (string | number)[] = [merchantId];

  if (options?.status) {
    query += ` AND status = ?`;
    params.push(options.status);
  }

  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const result = await env.DB.prepare(query).bind(...params).all();
  return (result.results || []).map((row) =>
    rowToDispute(row as Record<string, unknown>)
  );
}

export async function listOpenDisputes(
  env: Env,
  options?: { limit?: number; offset?: number }
): Promise<Dispute[]> {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  const result = await env.DB.prepare(
    `SELECT * FROM disputes 
     WHERE status IN ('opened', 'evidence_required', 'under_review')
     ORDER BY evidence_due_by ASC
     LIMIT ? OFFSET ?`
  )
    .bind(limit, offset)
    .all();

  return (result.results || []).map((row) =>
    rowToDispute(row as Record<string, unknown>)
  );
}
