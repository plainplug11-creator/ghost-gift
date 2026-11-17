export function todayKyiv(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * D1 has no interactive transactions, only atomic batches. A mutation reads
 * state, computes, then commits every write in ONE db.batch(). The batch starts
 * with a guard that aborts it if the user's row version changed meanwhile
 * (optimistic concurrency); the caller then re-reads and retries.
 */
export class Tx {
  stmts: D1PreparedStatement[] = [];
  constructor(public db: D1Database) {}
  add(sql: string, ...args: unknown[]) { this.stmts.push(this.db.prepare(sql).bind(...args)); }
  guardUser(userId: string, version: number) {
    this.add('INSERT INTO tx_guard (n) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ?)', userId, version);
    this.add('UPDATE users SET version = version + 1 WHERE id = ?', userId);
  }
  async commit() { if (this.stmts.length) await this.db.batch(this.stmts); }
}

export const isConflict = (e: unknown) => /constraint failed/i.test(String((e as Error)?.message ?? e));
