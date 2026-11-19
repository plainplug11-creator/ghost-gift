-- Wheel / Slots, luck card, levels, daily streak, quests, achievements, referrals, live feed, settings.
ALTER TABLE users ADD COLUMN luck_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN luck_day TEXT;
ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN week_key TEXT;
ALTER TABLE users ADD COLUMN week_xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN streak_day TEXT;
ALTER TABLE users ADD COLUMN streak_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN quests TEXT;
ALTER TABLE users ADD COLUMN ach TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN referred_by TEXT;
ALTER TABLE users ADD COLUMN ref_earned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN hide_feed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN notify INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN notified_day TEXT;
ALTER TABLE users ADD COLUMN bot_started INTEGER NOT NULL DEFAULT 0;

-- luck set by the admin before the luck card existed stays permanent
UPDATE users SET luck_until = 4102444800000 WHERE luck_pct > 0;

CREATE INDEX IF NOT EXISTS users_week ON users (week_key, week_xp);
CREATE INDEX IF NOT EXISTS users_ref ON users (referred_by);

-- Every real round of every game (cases, wheel, slots): feed, leaderboard, history.
CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  game TEXT NOT NULL,           -- case id | wheel | slots
  round_id TEXT NOT NULL,
  bet INTEGER NOT NULL,
  payout INTEGER NOT NULL,
  prize_id TEXT NOT NULL,       -- prize id | x2 | g3 …
  rarity TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plays_time ON plays (created_at);
CREATE INDEX IF NOT EXISTS plays_user ON plays (user_id, created_at);

-- Referral payouts (one row per paid friend top-up).
CREATE TABLE IF NOT EXISTS ref_rewards (
  charge_id TEXT PRIMARY KEY,
  referrer TEXT NOT NULL,
  referee TEXT NOT NULL,
  stars INTEGER NOT NULL,
  welcome INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ref_rewards_referrer ON ref_rewards (referrer, created_at);
