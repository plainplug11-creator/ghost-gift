import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`
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
      stats_best REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS inventory (
      uid TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      prize_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      won_at INTEGER NOT NULL,
      status TEXT NOT NULL
    );
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
    CREATE TABLE IF NOT EXISTS spin_times (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fingerprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      seen_at INTEGER NOT NULL
    );
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
  `);
  return db;
}

export function withTx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  }
}

export function todayKyiv(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
