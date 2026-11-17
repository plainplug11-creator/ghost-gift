import type { Ctx } from './ctx.ts';
import { notifyUser } from './delivery.ts';
import { log } from './log.ts';
import { bumpRiskStmt } from './risk.ts';
import { ApiError, getOrCreateUser, ledger, mustUser, withRetry } from './users.ts';
import { randomHex } from './crypto.ts';

export const TOPUP_MIN = 1;
export const TOPUP_MAX = 10000;

/** Create a Stars (XTR) invoice link for a balance top-up. */
export async function createTopup(ctx: Ctx, userId: string, stars: number) {
  if (!Number.isInteger(stars) || stars < TOPUP_MIN || stars > TOPUP_MAX) throw new ApiError(400, 'NOT_FOUND', 'bad_amount');
  await getOrCreateUser(ctx.db, userId);
  const id = randomHex(8);
  const link = await ctx.tg.call<string>('createInvoiceLink', {
    title: `${stars} ⭐ Ghost Stars`,
    description: `Пополнение баланса Ghost Gift на ${stars} звёзд`,
    payload: `inv:${id}`,
    currency: 'XTR',
    prices: [{ label: `${stars} Stars`, amount: stars }],
  });
  await ctx.db.prepare("INSERT INTO invoices (id, user_id, stars, status, created_at) VALUES (?, ?, ?, 'pending', ?)").bind(id, userId, stars, Date.now()).run();
  log('info', 'invoice_created', { id, user: userId, stars });
  return { invoiceId: id, link, stars };
}

export async function invoiceStatus(ctx: Ctx, userId: string, id: string) {
  const inv = await ctx.db.prepare('SELECT status, stars FROM invoices WHERE id = ? AND user_id = ?').bind(id, userId).first<{ status: string; stars: number }>();
  if (!inv) throw new ApiError(404, 'NOT_FOUND');
  const u = await mustUser(ctx.db, userId);
  return { status: inv.status, stars: inv.stars, balance: u.balance };
}

/** pre_checkout_query: only our pending invoices with the exact amount. */
export async function checkPreCheckout(ctx: Ctx, q: { from: { id: number }; currency: string; total_amount: number; invoice_payload: string }) {
  const m = /^inv:([0-9a-f]{16})$/.exec(q.invoice_payload || '');
  if (!m) return 'unknown invoice';
  const inv = await ctx.db.prepare('SELECT user_id, stars, status FROM invoices WHERE id = ?').bind(m[1]).first<{ user_id: string; stars: number; status: string }>();
  if (!inv || inv.status !== 'pending') return 'invoice expired';
  if (q.currency !== 'XTR' || q.total_amount !== inv.stars) return 'amount mismatch';
  if (String(q.from.id) !== inv.user_id) return 'wrong user';
  return null;
}

function payloadUser(payload?: string): { userId: string | null; invoiceId: string | null } {
  if (!payload) return { userId: null, invoiceId: null };
  const m = /^inv:([0-9a-f]{16})$/.exec(payload);
  if (m) return { userId: null, invoiceId: m[1] };
  try {
    const j = JSON.parse(payload);
    if (j && j.userId != null) return { userId: String(j.userId), invoiceId: null };
  } catch { /* plain id */ }
  return { userId: /^\d+$/.test(payload) ? payload : null, invoiceId: null };
}

/** successful_payment: credit once per telegram_payment_charge_id. */
export async function creditPayment(ctx: Ctx, p: { telegram_payment_charge_id?: string; total_amount?: number; currency?: string; invoice_payload?: string }, fromId?: number) {
  const chargeId = p.telegram_payment_charge_id;
  const stars = Number(p.total_amount) || 0;
  const parsed = payloadUser(p.invoice_payload);
  let userId = parsed.userId;
  if (parsed.invoiceId) {
    const inv = await ctx.db.prepare('SELECT user_id FROM invoices WHERE id = ?').bind(parsed.invoiceId).first<{ user_id: string }>();
    userId = inv?.user_id ?? (fromId ? String(fromId) : null);
  }
  if (!userId && fromId) userId = String(fromId);
  if (!chargeId || !userId || stars <= 0) {
    log('warn', 'bad_payment', { chargeId: chargeId ?? null });
    return { status: 'ignored' as const };
  }
  const res = await withRetry(ctx.db, async (tx) => {
    const existing = await ctx.db.prepare('SELECT charge_id FROM payments WHERE charge_id = ?').bind(chargeId).first();
    if (existing) return { status: 'duplicate' as const, chargeId };
    const u = await getOrCreateUser(ctx.db, userId!);
    const balance = u.balance + stars;
    tx.guardUser(userId!, u.version);
    tx.add('INSERT INTO payments (charge_id, user_id, stars, created_at, refunded) VALUES (?, ?, ?, ?, 0)', chargeId, userId, stars, Date.now());
    tx.add('UPDATE users SET balance = ? WHERE id = ?', balance, userId);
    if (parsed.invoiceId) tx.add("UPDATE invoices SET status = 'paid', charge_id = ?, paid_at = ? WHERE id = ?", chargeId, Date.now(), parsed.invoiceId);
    ledger(tx, userId!, 'stars_payment', stars, balance, chargeId);
    return { status: 'credited' as const, chargeId, balance };
  });
  if (res.status === 'credited') {
    log('info', 'payment_credited', { user: userId, stars });
    await notifyUser(ctx, userId, 'credited', { n: stars, b: res.balance });
  }
  return res;
}

export async function applyRefund(ctx: Ctx, chargeId: string, amount: number) {
  const res = await withRetry(ctx.db, async (tx) => {
    const row = await ctx.db.prepare('SELECT charge_id, user_id, stars, refunded FROM payments WHERE charge_id = ?').bind(chargeId)
      .first<{ charge_id: string; user_id: string; stars: number; refunded: number }>();
    if (!row) return { status: 'unknown_charge' as const, chargeId };
    if (row.refunded) return { status: 'already_refunded' as const, chargeId };
    const stars = amount || row.stars;
    const u = await mustUser(ctx.db, row.user_id);
    const balance = Math.max(0, u.balance - stars);
    tx.guardUser(row.user_id, u.version);
    tx.add('INSERT INTO tx_guard (n) SELECT 1 WHERE EXISTS (SELECT 1 FROM payments WHERE charge_id = ? AND refunded = 1)', chargeId);
    tx.add('UPDATE payments SET refunded = 1 WHERE charge_id = ?', chargeId);
    tx.add("UPDATE invoices SET status = 'refunded' WHERE charge_id = ?", chargeId);
    tx.add('UPDATE users SET balance = ? WHERE id = ?', balance, row.user_id);
    tx.stmts.push(bumpRiskStmt(ctx.db, row.user_id, 30, true));
    ledger(tx, row.user_id, 'refund', -stars, balance, chargeId);
    return { status: 'refunded' as const, chargeId, balance, flagged: true, userId: row.user_id, stars };
  });
  if (res.status === 'refunded') {
    log('warn', 'payment_refunded', { user: res.userId, stars: res.stars });
    await notifyUser(ctx, res.userId, 'refunded', { n: res.stars });
    const { userId: _u, stars: _s, ...out } = res;
    return out;
  }
  return res;
}
