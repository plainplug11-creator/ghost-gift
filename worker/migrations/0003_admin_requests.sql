-- /admin without a valid code: the request is recorded and an operator promotes it
-- with scripts/promote-admin.sh (no secret ever travels through chat).
CREATE TABLE IF NOT EXISTS admin_requests (
  tg_id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  requested_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'promoted', 'dismissed'))
);
