-- Ghost Gift anticheat schema (port of server/src/db.ts) for Cloudflare D1.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  client_seed TEXT NOT NULL,
  server_seed TEXT NOT NULL,
  nonce INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  daily_ready_at INTEGER NOT NULL DEFAULT 0,
  risk_score INTEGER NOT NULL DEFAULT 0,
  flagged INTEGER NOT NULL DEFAULT 0,
  stats_opens INTEGER NOT NULL DEFAULT 0,
  stats_wins INTEGER NOT NULL DEFAULT 0,
  stats_best REAL NOT NULL DEFAULT 0,
  -- optimistic-concurrency version: D1 has no interactive transactions
  version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory (
  uid TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  prize_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  won_at INTEGER NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inventory_user ON inventory (user_id, won_at);

CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  ref TEXT,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger (user_id, created_at);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS fairness_log (
  round_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  server_seed TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  client_seed TEXT NOT NULL,
  nonce INTEGER NOT NULL,
  roll REAL NOT NULL,
  prize_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fairness_user ON fairness_log (user_id, nonce);

CREATE TABLE IF NOT EXISTS spin_times (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS spin_user ON spin_times (user_id, ts);

-- One row per distinct (user, device, ip), seen_at = last seen.
CREATE TABLE IF NOT EXISTS fingerprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  seen_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS fp_user_dev_ip ON fingerprints (user_id, device_id, ip);
CREATE INDEX IF NOT EXISTS fp_device ON fingerprints (device_id);
CREATE INDEX IF NOT EXISTS fp_ip ON fingerprints (ip);

CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_uid TEXT NOT NULL,
  prize_id TEXT NOT NULL,
  value INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS withdrawals_status ON withdrawals (status, created_at);

CREATE TABLE IF NOT EXISTS payments (
  charge_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stars INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  refunded INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bank (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  balance INTEGER NOT NULL,
  big_prizes_today INTEGER NOT NULL,
  day TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

-- Batch guard: inserting n = 1 violates the CHECK and aborts the whole D1 batch.
CREATE TABLE IF NOT EXISTS tx_guard (
  n INTEGER NOT NULL CHECK (n = 0)
);
