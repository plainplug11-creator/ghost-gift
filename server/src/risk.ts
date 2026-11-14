import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.ts';

export function bumpRisk(db: DatabaseSync, userId: string, delta: number, flag = false) {
  db.prepare(`UPDATE users SET risk_score = MIN(100, MAX(0, risk_score + ?)), flagged = CASE WHEN ? THEN 1 ELSE flagged END WHERE id = ?`)
    .run(delta, flag ? 1 : 0, userId);
}

export function recordFingerprint(db: DatabaseSync, cfg: Config, userId: string, deviceId: string, ip: string) {
  const now = Date.now();
  db.prepare('INSERT INTO fingerprints (user_id, device_id, ip, seen_at) VALUES (?, ?, ?, ?)').run(userId, deviceId || '', ip || '', now);
  // keep last 50 per user
  db.prepare(`DELETE FROM fingerprints WHERE user_id = ? AND id NOT IN (SELECT id FROM fingerprints WHERE user_id = ? ORDER BY seen_at DESC LIMIT 50)`).run(userId, userId);

  const others: string[] = [];
  if (deviceId) {
    for (const r of db.prepare('SELECT DISTINCT user_id FROM fingerprints WHERE device_id = ? AND user_id != ?').all(deviceId, userId) as { user_id: string }[]) {
      others.push(r.user_id);
    }
  }
  if (others.length) {
    bumpRisk(db, userId, 20, true);
    for (const o of others) bumpRisk(db, o, 10, true);
    return;
  }
  if (ip && ip !== '127.0.0.1' && ip !== '::1') {
    const n = (db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM fingerprints WHERE ip = ?').get(ip) as { n: number }).n;
    if (n >= 3) bumpRisk(db, userId, 10);
  }
  void cfg;
}

export function hitRateLimit(db: DatabaseSync, key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const row = db.prepare('SELECT window_start, count FROM rate WHERE key = ?').get(key) as { window_start: number; count: number } | undefined;
  if (!row || now - row.window_start >= windowMs) {
    db.prepare('INSERT INTO rate (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1').run(key, now);
    return false;
  }
  db.prepare('UPDATE rate SET count = count + 1 WHERE key = ?').run(key);
  return row.count + 1 > limit;
}

export function inspectSpinTiming(db: DatabaseSync, cfg: Config, userId: string): { autoclicker: boolean } {
  const now = Date.now();
  db.prepare('INSERT INTO spin_times (user_id, ts) VALUES (?, ?)').run(userId, now);
  db.prepare(`DELETE FROM spin_times WHERE user_id = ? AND id NOT IN (SELECT id FROM spin_times WHERE user_id = ? ORDER BY ts DESC LIMIT 12)`).run(userId, userId);
  const rows = db.prepare('SELECT ts FROM spin_times WHERE user_id = ? ORDER BY ts ASC').all(userId) as { ts: number }[];
  if (rows.length < 6) return { autoclicker: false };
  const intervals = [];
  for (let i = 1; i < rows.length; i++) intervals.push(rows[i].ts - rows[i - 1].ts);
  const recent = intervals.slice(-8);
  const tooFast = recent.length >= 5 && recent.every((x) => x < cfg.autoclickMinMs);
  const mean = recent.reduce((s, x) => s + x, 0) / recent.length;
  const std = Math.sqrt(recent.reduce((s, x) => s + (x - mean) ** 2, 0) / recent.length);
  const tooRegular = recent.length >= 6 && std < cfg.autoclickRegularStddevMs && mean < 2000;
  if (tooFast || tooRegular) {
    bumpRisk(db, userId, tooFast && tooRegular ? 25 : 20, true);
    return { autoclicker: true };
  }
  return { autoclicker: false };
}
