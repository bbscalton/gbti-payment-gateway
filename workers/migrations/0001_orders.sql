-- Orders only — never store PAN, CVV, or expiry
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  payment_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
