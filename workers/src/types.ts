/**
 * Sapp — Type definitions
 * Card data (PAN, CVV, expiry) is NEVER stored.
 */

// ============================================================================
// ORDER TYPES
// ============================================================================

export type OrderStatus =
  | "pending"
  | "authorized"
  | "captured"
  | "partially_captured"
  | "voided"
  | "failed"
  | "refunded"
  | "partially_refunded"
  | "disputed"
  | "chargeback_lost"
  | "chargeback_won";

export interface Order {
  id: string;
  merchantId: string;
  amountCents: number;
  capturedCents: number;
  refundedCents: number;
  currency: string;
  description: string;
  status: OrderStatus;
  paymentRef: string | null;
  authorizationRef: string | null;
  threeDsStatus: ThreeDsStatus | null;
  idempotencyKey: string | null;
  metadata: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

export type ThreeDsStatus = "not_required" | "challenge_required" | "authenticated" | "failed";

// ============================================================================
// MERCHANT TYPES
// ============================================================================

export type MerchantStatus = "pending" | "approved" | "suspended" | "rejected";

export interface Merchant {
  id: string;
  name: string;
  email: string;
  status: MerchantStatus;
  webhookUrl: string | null;
  webhookSecret: string | null;
  testApiKeyHash: string | null;
  liveApiKeyHash: string | null;
  testApiKeyPrefix: string | null;
  liveApiKeyPrefix: string | null;
  kybData: MerchantKybData | null;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantKybData {
  businessName: string;
  businessRegistrationNumber: string | null;
  businessAddress: string | null;
  businessType: string | null;
  taxId: string | null;
  representativeName: string | null;
  representativeEmail: string | null;
  representativePhone: string | null;
  expectedMonthlyVolume: string | null;
  website: string | null;
}

// ============================================================================
// WEBHOOK EVENT TYPES
// ============================================================================

export type WebhookEventType =
  | "payment.authorized"
  | "payment.captured"
  | "payment.failed"
  | "payment.refunded"
  | "payment.voided"
  | "payment.disputed"
  | "payment.chargeback";

export type WebhookEventStatus = "pending" | "delivered" | "failed" | "exhausted";

export interface WebhookEvent {
  id: string;
  merchantId: string;
  orderId: string;
  eventType: WebhookEventType;
  payload: string;
  status: WebhookEventStatus;
  attempts: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

// ============================================================================
// LEDGER TYPES
// ============================================================================

export type LedgerEntryType =
  | "payment_received"
  | "fee_charged"
  | "refund_issued"
  | "chargeback_debit"
  | "chargeback_reversal"
  | "payout"
  | "reserve_hold"
  | "reserve_release";

export interface LedgerEntry {
  id: string;
  merchantId: string;
  orderId: string | null;
  entryType: LedgerEntryType;
  debitCents: number;
  creditCents: number;
  balanceAfterCents: number;
  currency: string;
  description: string;
  createdAt: string;
}

export interface SettlementReport {
  id: string;
  merchantId: string;
  periodStart: string;
  periodEnd: string;
  grossCents: number;
  feesCents: number;
  refundsCents: number;
  chargebacksCents: number;
  netCents: number;
  status: "pending" | "processed" | "paid";
  createdAt: string;
}

// ============================================================================
// DISPUTE TYPES
// ============================================================================

export type DisputeStatus =
  | "opened"
  | "evidence_required"
  | "under_review"
  | "won"
  | "lost"
  | "expired";

export type DisputeReason =
  | "fraudulent"
  | "duplicate"
  | "product_not_received"
  | "product_unacceptable"
  | "subscription_canceled"
  | "unrecognized"
  | "other";

export interface Dispute {
  id: string;
  merchantId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  reason: DisputeReason;
  status: DisputeStatus;
  evidenceUrl: string | null;
  evidenceDueBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// AUDIT LOG TYPES
// ============================================================================

export type AuditAction =
  | "order.created"
  | "order.authorized"
  | "order.captured"
  | "order.voided"
  | "order.refunded"
  | "merchant.created"
  | "merchant.updated"
  | "merchant.api_key_rotated"
  | "webhook.delivered"
  | "webhook.failed"
  | "dispute.opened"
  | "dispute.resolved";

export interface AuditLogEntry {
  id: string;
  merchantId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  actorType: "merchant" | "system" | "admin";
  actorId: string | null;
  ipAddress: string | null;
  details: string | null;
  createdAt: string;
}

// ============================================================================
// IDEMPOTENCY TYPES
// ============================================================================

export interface IdempotencyRecord {
  key: string;
  merchantId: string;
  response: string;
  statusCode: number;
  createdAt: string;
  expiresAt: string;
}

// ============================================================================
// API ERROR TYPES
// ============================================================================

export type ErrorCode =
  | "invalid_request"
  | "authentication_required"
  | "invalid_api_key"
  | "forbidden"
  | "not_found"
  | "order_not_found"
  | "merchant_not_found"
  | "idempotency_conflict"
  | "rate_limited"
  | "invalid_card_number"
  | "card_expired"
  | "invalid_cvv"
  | "card_declined"
  | "insufficient_funds"
  | "do_not_honor"
  | "3ds_required"
  | "3ds_failed"
  | "invalid_amount"
  | "invalid_currency"
  | "invalid_state_transition"
  | "refund_exceeds_captured"
  | "capture_exceeds_authorized"
  | "webhook_secret_missing"
  | "webhook_signature_invalid"
  | "webhook_replay_detected"
  | "internal_error"
  | "use_test_card";

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ============================================================================
// ENVIRONMENT
// ============================================================================

export interface Env {
  DB: D1Database;
  ORDERS?: KVNamespace;
  WEBHOOK_SECRET: string;
  MERCHANT_MASTER_KEY?: string;
  PUBLIC_BASE_URL?: string;
  ALLOWED_ORIGINS?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
}

// ============================================================================
// ACQUIRER ADAPTER INTERFACE
// ============================================================================

export interface AcquirerResponse {
  success: boolean;
  transactionRef: string;
  authorizationCode?: string;
  errorCode?: ErrorCode;
  errorMessage?: string;
  threeDsRequired?: boolean;
  threeDsChallengeUrl?: string;
}

export interface AcquirerAdapter {
  authorize(params: {
    amountCents: number;
    currency: string;
    cardToken?: string;
    orderId: string;
    merchantId: string;
  }): Promise<AcquirerResponse>;

  capture(params: {
    authorizationRef: string;
    amountCents: number;
    orderId: string;
  }): Promise<AcquirerResponse>;

  void(params: {
    authorizationRef: string;
    orderId: string;
  }): Promise<AcquirerResponse>;

  refund(params: {
    transactionRef: string;
    amountCents: number;
    orderId: string;
  }): Promise<AcquirerResponse>;
}
