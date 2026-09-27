-- Migration: 3-D Secure challenge records
-- A payment that requires 3DS can only be completed with a server-issued,
-- single-use, time-limited challenge. Additive only.

CREATE TABLE IF NOT EXISTS three_ds_challenges (
  id TEXT PRIMARY KEY NOT NULL,              -- server-generated, unguessable (3ds_<128-bit hex>)
  order_id TEXT NOT NULL REFERENCES orders(id),
  payment_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | succeeded | failed | expired | superseded
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_3ds_challenges_order ON three_ds_challenges(order_id, status);
