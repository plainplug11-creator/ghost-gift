import type { Config } from './config.ts';

const BUMP_SQL = 'UPDATE users SET risk_score = MIN(100, MAX(0, risk_score + ?)), flagged = CASE WHEN ? THEN 1 ELSE flagged END WHERE id = ?';

export function bumpRiskStmt(db: D1Database, userId: string, delta: number, flag = false) {
  return db.prepare(BUMP_SQL).bind(delta, flag ? 1 : 0, userId);
}

/** Multi-account detection: shared device id → flag all; ≥3 accounts per IP → +10. */
export async function recordFingerprint(db: D1Database, cfg: Config, userId: string, deviceId: string, ip: string) {
  const now = Date.now();
  const dev = deviceId || '';
  const addr = ip || '';
  const checkIp = !!addr && addr !== '127.0.0.1' && addr !== '::1';
  const [, , others, ipCount] = await db.batch([
    db.prepare(`INSERT INTO fingerprints (user_id, device_id, ip, seen_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, device_id, ip) DO UPDATE SET seen_at = excluded.seen_at`).bind(userId, dev, addr, now),
    // keep last 50 per user
    db.prepare('DELETE FROM fingerprints WHERE user_id = ? AND id NOT IN (SELECT id FROM fingerprints WHERE user_id = ? ORDER BY seen_at DESC LIMIT 50)').bind(userId, userId),
    db.prepare('SELECT DISTINCT user_id FROM fingerprints WHERE device_id = ? AND device_id != \'\' AND user_id != ?').bind(dev, userId),
    db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM fingerprints WHERE ip = ? AND ? = 1').bind(addr, checkIp ? 1 : 0),
  ]);
  const otherIds = ((others.results || []) as { user_id: string }[]).map((r) => r.user_id);
  if (otherIds.length) {
    await db.batch([bumpRiskStmt(db, userId, 20, true), ...otherIds.map((o) => bumpRiskStmt(db, o, 10, true))]);
    return;
  }
  const n = ((ipCount.results?.[0] as { n: number } | undefined)?.n) ?? 0;
  if (checkIp && n >= 3) await bumpRiskStmt(db, userId, 10).run();
  void cfg;
}

/** Fixed-window limiter in one atomic upsert. */
export async function hitRateLimit(db: D1Database, key: string, limit: number, windowMs = 60_000): Promise<boolean> {
  const now = Date.now();
  const row = await db.prepare(`INSERT INTO rate (key, window_start, count) VALUES (?1, ?2, 1)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE count + 1 END,
      window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END
    RETURNING count`).bind(key, now, windowMs).first<{ count: number }>();
  return (row?.count ?? 1) > limit;
}

/**
 * Token bucket for general API traffic: `burst` requests can arrive back-to-back (fast screen switching,
 * app reloads), then tokens refill at `perMin`. A denied request leaves at most one token of debt, so
 * hammering keeps you throttled while a normal user never notices. Money endpoints keep their own
 * strict fixed-window limit (hitRateLimit) plus autoclicker checks.
 */
export async function hitBurstLimit(db: D1Database, key: string, perMin: number, burst: number): Promise<boolean> {
  const now = Date.now();
  const row = await db.prepare(`INSERT INTO rate (key, window_start, count) VALUES (?1, ?2, ?3 - 1)
    ON CONFLICT(key) DO UPDATE SET
      count = MAX(-1.0, MIN(?3 * 1.0, count + (?2 - window_start) * ?4) - 1),
      window_start = ?2
    RETURNING count`).bind(key, now, burst, perMin / 60_000).first<{ count: number }>();
  return (row?.count ?? 0) < 0;
}

export async function inspectSpinTiming(db: D1Database, cfg: Config, userId: string): Promise<{ autoclicker: boolean }> {
  const now = Date.now();
  const [, , sel] = await db.batch([
    db.prepare('INSERT INTO spin_times (user_id, ts) VALUES (?, ?)').bind(userId, now),
    db.prepare('DELETE FROM spin_times WHERE user_id = ? AND id NOT IN (SELECT id FROM spin_times WHERE user_id = ? ORDER BY ts DESC LIMIT 12)').bind(userId, userId),
    db.prepare('SELECT ts FROM spin_times WHERE user_id = ? ORDER BY ts ASC').bind(userId),
  ]);
  const rows = (sel.results || []) as { ts: number }[];
  if (rows.length < 6) return { autoclicker: false };
  const intervals: number[] = [];
  for (let i = 1; i < rows.length; i++) intervals.push(rows[i].ts - rows[i - 1].ts);
  const recent = intervals.slice(-8);
  const tooFast = recent.length >= 5 && recent.every((x) => x < cfg.autoclickMinMs);
  const mean = recent.reduce((s, x) => s + x, 0) / recent.length;
  const std = Math.sqrt(recent.reduce((s, x) => s + (x - mean) ** 2, 0) / recent.length);
  const tooRegular = recent.length >= 6 && std < cfg.autoclickRegularStddevMs && mean < 2000;
  if (tooFast || tooRegular) {
    await bumpRiskStmt(db, userId, tooFast && tooRegular ? 25 : 20, true).run();
    return { autoclicker: true };
  }
  return { autoclicker: false };
}
