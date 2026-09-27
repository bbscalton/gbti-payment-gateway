-- Migration: Add merchants, security, and gateway features
-- NEVER store PAN, CVV, or expiry in any table

-- Merchants table
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  webhook_url TEXT,
  webhook_secret TEXT,
  test_api_key_hash TEXT,
  live_api_key_hash TEXT,
  test_api_key_prefix TEXT,
  live_api_key_prefix TEXT,
  kyb_data TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email);
CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants(status);

-- Add merchant_id to orders (nullable for migration)
ALTER TABLE orders ADD COLUMN merchant_id TEXT REFERENCES merchants(id);
ALTER TABLE orders ADD COLUMN captured_cents INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN refunded_cents INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN authorization_ref TEXT;
ALTER TABLE orders ADD COLUMN three_ds_status TEXT;
ALTER TABLE orders ADD COLUMN idempotency_key TEXT;
ALTER TABLE orders ADD COLUMN metadata TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_merchant_id ON orders(merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_idempotency ON orders(merchant_id, idempotency_key);

-- Webhook events table
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  order_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_merchant ON webhook_events(merchant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status, next_attempt_at);

-- Ledger entries table (double-entry)
CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  order_id TEXT,
  entry_type TEXT NOT NULL,
  debit_cents INTEGER NOT NULL DEFAULT 0,
  credit_cents INTEGER NOT NULL DEFAULT 0,
  balance_after_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_merchant ON ledger_entries(merchant_id, created_at DESC);

-- Settlement reports table
CREATE TABLE IF NOT EXISTS settlement_reports (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  gross_cents INTEGER NOT NULL,
  fees_cents INTEGER NOT NULL,
  refunds_cents INTEGER NOT NULL,
  chargebacks_cents INTEGER NOT NULL,
  net_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settlement_merchant ON settlement_reports(merchant_id, period_start);

-- Disputes table
CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'opened',
  evidence_url TEXT,
  evidence_due_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_disputes_merchant ON disputes(merchant_id);
CREATE INDEX IF NOT EXISTS idx_disputes_order ON disputes(order_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  ip_address TEXT,
  details TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_merchant ON audit_log(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);

-- Idempotency records table
CREATE TABLE IF NOT EXISTS idempotency_records (
  key TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  response TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (merchant_id, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_records(expires_at);

-- Processed webhook event IDs for replay protection
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_events_time ON processed_webhook_events(processed_at);
