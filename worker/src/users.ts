import { randomHex } from './crypto.ts';
import { Tx, isConflict } from './db.ts';
import { newSeed } from './fair.ts';

export class ApiError extends Error {
  constructor(public status: number, public code: string, msg = code) { super(msg); }
}

export interface UserRow {
  id: string; balance: number; client_seed: string; server_seed: string; nonce: number;
  created_at: number; daily_ready_at: number; risk_score: number; flagged: number;
  stats_opens: number; stats_wins: number; stats_best: number; version: number;
  luck_pct: number; lang: string | null; tg_username: string | null; tg_first_name: string | null;
}

export async function getOrCreateUser(db: D1Database, userId: string): Promise<UserRow> {
  const existing = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<UserRow>();
  if (existing) return existing;
  await db.prepare('INSERT OR IGNORE INTO users (id, balance, client_seed, server_seed, nonce, created_at) VALUES (?, 0, ?, ?, 0, ?)')
    .bind(userId, newSeed(8), newSeed(32), Date.now()).run();
  return mustUser(db, userId);
}
export async function mustUser(db: D1Database, userId: string): Promise<UserRow> {
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<UserRow>();
  if (!u) throw new ApiError(404, 'NOT_FOUND');
  return u;
}

export function ledger(tx: Tx, userId: string, type: string, amount: number, balanceAfter: number, ref: string) {
  tx.add('INSERT INTO ledger (id, user_id, type, amount, balance_after, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    randomHex(8), userId, type, amount, balanceAfter, ref, Date.now());
}

/** Relative balance change that also bumps the version (so concurrent absolute writers retry). */
export function creditRelative(tx: Tx, userId: string, amount: number, type: string, ref: string) {
  tx.add('UPDATE users SET balance = MAX(0, balance + ?), version = version + 1 WHERE id = ?', amount, userId);
  tx.add('INSERT INTO ledger (id, user_id, type, amount, balance_after, ref, created_at) SELECT ?, ?, ?, ?, balance, ?, ? FROM users WHERE id = ?',
    randomHex(8), userId, type, amount, ref, Date.now(), userId);
}

/** Run read→compute→batch with optimistic-concurrency retries. */
export async function withRetry<T>(db: D1Database, fn: (tx: Tx, attempt: number) => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const tx = new Tx(db);
    const out = await fn(tx, attempt);
    try {
      await tx.commit();
      return out;
    } catch (e) {
      if (isConflict(e) && attempt + 1 < attempts) continue;
      if (isConflict(e)) throw new ApiError(429, 'BUSY', 'conflict');
      throw e;
    }
  }
}
