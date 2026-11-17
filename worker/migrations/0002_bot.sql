-- Bot, payments, prize delivery, NFT stock, admin.
ALTER TABLE users ADD COLUMN tg_username TEXT;
ALTER TABLE users ADD COLUMN tg_first_name TEXT;
ALTER TABLE users ADD COLUMN lang TEXT;
ALTER TABLE users ADD COLUMN luck_pct INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0;

ALTER TABLE inventory ADD COLUMN nft_id INTEGER;
ALTER TABLE inventory ADD COLUMN value INTEGER;

ALTER TABLE withdrawals ADD COLUMN kind TEXT;
ALTER TABLE withdrawals ADD COLUMN months INTEGER;
ALTER TABLE withdrawals ADD COLUMN nft_id INTEGER;
ALTER TABLE withdrawals ADD COLUMN paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE withdrawals ADD COLUMN decided_by TEXT;
ALTER TABLE withdrawals ADD COLUMN decided_at INTEGER;
ALTER TABLE withdrawals ADD COLUMN admin_chat TEXT;
ALTER TABLE withdrawals ADD COLUMN admin_msg INTEGER;
CREATE INDEX IF NOT EXISTS withdrawals_user ON withdrawals (user_id, created_at);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stars INTEGER NOT NULL,
  status TEXT NOT NULL,          -- pending | paid | refunded | expired
  charge_id TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS invoices_status ON invoices (status, created_at);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  withdrawal_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- gift | premium | nft
  prize_id TEXT NOT NULL,
  months INTEGER,
  nft_id INTEGER,
  cost INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,          -- queued | sending | delivered | waiting_funds | waiting_business | failed | unknown | cancelled
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  admin_notified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries (status, next_at);

CREATE TABLE IF NOT EXISTS nft_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owned_gift_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,            -- t.me/nft/<name>
  title TEXT NOT NULL,
  value INTEGER NOT NULL,
  tier TEXT NOT NULL,
  transfer_cost INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,          -- in_stock | reserved | delivered | removed
  item_uid TEXT,
  added_at INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS nft_stock_tier ON nft_stock (status, tier);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS business_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_chat_id TEXT,
  enabled INTEGER NOT NULL,
  rights TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tg_updates (
  update_id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL
);
