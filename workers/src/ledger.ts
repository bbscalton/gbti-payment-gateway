/**
 * Neuereatec Pay — Double-Entry Ledger
 * Tracks merchant balances, fees, refunds, and settlements
 */

import type { 
  Env, 
  LedgerEntry, 
  LedgerEntryType, 
  SettlementReport 
} from "./types";

function rowToLedgerEntry(row: Record<string, unknown>): LedgerEntry {
  return {
    id: String(row.id),
    merchantId: String(row.merchant_id),
    orderId: row.order_id ? String(row.order_id) : null,
    entryType: String(row.entry_type) as LedgerEntryType,
    debitCents: Number(row.debit_cents),
    creditCents: Number(row.credit_cents),
    balanceAfterCents: Number(row.balance_after_cents),
    currency: String(row.currency),
    description: String(row.description),
    createdAt: String(row.created_at),
  };
}

function rowToSettlementReport(row: Record<string, unknown>): SettlementReport {
  return {
    id: String(row.id),
    merchantId: String(row.merchant_id),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    grossCents: Number(row.gross_cents),
    feesCents: Number(row.fees_cents),
    refundsCents: Number(row.refunds_cents),
    chargebacksCents: Number(row.chargebacks_cents),
    netCents: Number(row.net_cents),
    status: String(row.status) as "pending" | "processed" | "paid",
    createdAt: String(row.created_at),
  };
}

export async function getMerchantBalance(env: Env, merchantId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT balance_after_cents FROM ledger_entries 
     WHERE merchant_id = ? 
     ORDER BY created_at DESC 
     LIMIT 1`
  )
    .bind(merchantId)
    .first();
  
  if (!row) return 0;
  return Number(row.balance_after_cents);
}

export async function createLedgerEntry(
  env: Env,
  input: {
    merchantId: string;
    orderId?: string;
    entryType: LedgerEntryType;
    debitCents: number;
    creditCents: number;
    currency: string;
    description: string;
  }
): Promise<LedgerEntry> {
  const id = `led_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  
  const currentBalance = await getMerchantBalance(env, input.merchantId);
  const balanceAfter = currentBalance + input.creditCents - input.debitCents;

  await env.DB.prepare(
    `INSERT INTO ledger_entries (
      id, merchant_id, order_id, entry_type, debit_cents, credit_cents,
      balance_after_cents, currency, description, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      input.merchantId,
      input.orderId || null,
      input.entryType,
      input.debitCents,
      input.creditCents,
      balanceAfter,
      input.currency,
      input.description,
      now
    )
    .run();

  const entry = await getLedgerEntry(env, id);
  if (!entry) throw new Error("Failed to create ledger entry");
  return entry;
}

export async function getLedgerEntry(env: Env, id: string): Promise<LedgerEntry | null> {
  const row = await env.DB.prepare(`SELECT * FROM ledger_entries WHERE id = ?`)
    .bind(id)
    .first();
  if (!row) return null;
  return rowToLedgerEntry(row as Record<string, unknown>);
}

export async function listLedgerEntries(
  env: Env,
  merchantId: string,
  options?: { 
    limit?: number; 
    offset?: number;
    startDate?: string;
    endDate?: string;
  }
): Promise<LedgerEntry[]> {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;
  
  let query = `SELECT * FROM ledger_entries WHERE merchant_id = ?`;
  const params: (string | number)[] = [merchantId];
  
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
    rowToLedgerEntry(row as Record<string, unknown>)
  );
}

export async function recordPaymentReceived(
  env: Env,
  merchantId: string,
  orderId: string,
  amountCents: number,
  currency: string,
  feePercent: number = 3.5
): Promise<{ paymentEntry: LedgerEntry; feeEntry: LedgerEntry }> {
  const feeCents = Math.round(amountCents * (feePercent / 100));
  const netCents = amountCents - feeCents;

  const paymentEntry = await createLedgerEntry(env, {
    merchantId,
    orderId,
    entryType: "payment_received",
    debitCents: 0,
    creditCents: amountCents,
    currency,
    description: `Payment received for order ${orderId}`,
  });

  const feeEntry = await createLedgerEntry(env, {
    merchantId,
    orderId,
    entryType: "fee_charged",
    debitCents: feeCents,
    creditCents: 0,
    currency,
    description: `Processing fee (${feePercent}%) for order ${orderId}`,
  });

  return { paymentEntry, feeEntry };
}

export async function recordRefund(
  env: Env,
  merchantId: string,
  orderId: string,
  amountCents: number,
  currency: string
): Promise<LedgerEntry> {
  return createLedgerEntry(env, {
    merchantId,
    orderId,
    entryType: "refund_issued",
    debitCents: amountCents,
    creditCents: 0,
    currency,
    description: `Refund issued for order ${orderId}`,
  });
}

export async function recordChargeback(
  env: Env,
  merchantId: string,
  orderId: string,
  amountCents: number,
  currency: string
): Promise<LedgerEntry> {
  return createLedgerEntry(env, {
    merchantId,
    orderId,
    entryType: "chargeback_debit",
    debitCents: amountCents,
    creditCents: 0,
    currency,
    description: `Chargeback debit for order ${orderId}`,
  });
}

export async function recordChargebackReversal(
  env: Env,
  merchantId: string,
  orderId: string,
  amountCents: number,
  currency: string
): Promise<LedgerEntry> {
  return createLedgerEntry(env, {
    merchantId,
    orderId,
    entryType: "chargeback_reversal",
    debitCents: 0,
    creditCents: amountCents,
    currency,
    description: `Chargeback reversal (won) for order ${orderId}`,
  });
}

export async function generateSettlementReport(
  env: Env,
  merchantId: string,
  periodStart: string,
  periodEnd: string
): Promise<SettlementReport> {
  const id = `stl_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const ledgerEntries = await listLedgerEntries(env, merchantId, {
    startDate: periodStart,
    endDate: periodEnd,
    limit: 10000,
  });

  let grossCents = 0;
  let feesCents = 0;
  let refundsCents = 0;
  let chargebacksCents = 0;

  for (const entry of ledgerEntries) {
    switch (entry.entryType) {
      case "payment_received":
        grossCents += entry.creditCents;
        break;
      case "fee_charged":
        feesCents += entry.debitCents;
        break;
      case "refund_issued":
        refundsCents += entry.debitCents;
        break;
      case "chargeback_debit":
        chargebacksCents += entry.debitCents;
        break;
      case "chargeback_reversal":
        chargebacksCents -= entry.creditCents;
        break;
    }
  }

  const netCents = grossCents - feesCents - refundsCents - chargebacksCents;

  await env.DB.prepare(
    `INSERT INTO settlement_reports (
      id, merchant_id, period_start, period_end, gross_cents, fees_cents,
      refunds_cents, chargebacks_cents, net_cents, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      merchantId,
      periodStart,
      periodEnd,
      grossCents,
      feesCents,
      refundsCents,
      chargebacksCents,
      netCents,
      "pending",
      now
    )
    .run();

  return {
    id,
    merchantId,
    periodStart,
    periodEnd,
    grossCents,
    feesCents,
    refundsCents,
    chargebacksCents,
    netCents,
    status: "pending",
    createdAt: now,
  };
}

export async function getSettlementReport(env: Env, id: string): Promise<SettlementReport | null> {
  const row = await env.DB.prepare(`SELECT * FROM settlement_reports WHERE id = ?`)
    .bind(id)
    .first();
  if (!row) return null;
  return rowToSettlementReport(row as Record<string, unknown>);
}

export async function listSettlementReports(
  env: Env,
  merchantId: string,
  options?: { limit?: number; offset?: number }
): Promise<SettlementReport[]> {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const result = await env.DB.prepare(
    `SELECT * FROM settlement_reports 
     WHERE merchant_id = ? 
     ORDER BY period_start DESC 
     LIMIT ? OFFSET ?`
  )
    .bind(merchantId, limit, offset)
    .all();

  return (result.results || []).map((row) =>
    rowToSettlementReport(row as Record<string, unknown>)
  );
}
