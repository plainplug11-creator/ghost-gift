import type { Config } from './config.ts';
import type { TgApi } from './telegram.ts';

export interface Ctx {
  db: D1Database;
  cfg: Config;
  tg: TgApi;
  waitUntil: (p: Promise<unknown>) => void;
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return r?.value ?? null;
}
export function setSetting(db: D1Database, key: string, value: string) {
  return db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

/** Admins: ADMIN_IDS var + the owner who claimed /admin with the one-time code. */
export async function adminIds(ctx: Ctx): Promise<string[]> {
  const claimed = await getSetting(ctx.db, 'admin_id');
  return [...new Set([...ctx.cfg.adminIds, ...(claimed ? [claimed] : [])])];
}
export async function isAdmin(ctx: Ctx, userId: string | number): Promise<boolean> {
  return (await adminIds(ctx)).includes(String(userId));
}

export interface BizConn { id: string; user_id: string; enabled: number; rights: Record<string, boolean> }
/** The owner's active Business connection that may transfer gifts (only admin accounts are trusted). */
export async function ownerConnection(ctx: Ctx): Promise<BizConn | null> {
  const admins = await adminIds(ctx);
  if (!admins.length) return null;
  const rows = await ctx.db.prepare(`SELECT id, user_id, enabled, rights FROM business_connections WHERE enabled = 1 AND user_id IN (${admins.map(() => '?').join(',')}) ORDER BY updated_at DESC`)
    .bind(...admins).all<{ id: string; user_id: string; enabled: number; rights: string }>();
  for (const r of rows.results ?? []) {
    const rights = JSON.parse(r.rights || '{}') as Record<string, boolean>;
    if (rights.can_transfer_and_upgrade_gifts) return { ...r, rights };
  }
  return null;
}

export const kyivDayStart = (now = Date.now()) => {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const guess = Date.parse(`${day}T00:00:00Z`);
  // Kyiv is UTC+2/+3: find the offset by formatting
  for (const off of [2, 3]) { const t = guess - off * 3600_000; if (new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', hour: '2-digit', hourCycle: 'h23' }).format(t) === '00') return t; }
  return guess - 2 * 3600_000;
};
