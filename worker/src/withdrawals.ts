import { adminIds, type Ctx } from './ctx.ts';
import { PREMIUM_STARS, enqueueDelivery, notifyUser, processDelivery, type DeliveryRow } from './delivery.ts';
import { log } from './log.ts';
import { esc, itemName } from './texts.ts';
import { creditRelative, withRetry } from './users.ts';

export interface WithdrawalRow {
  id: string; user_id: string; item_uid: string; prize_id: string; value: number; status: string; reason: string | null;
  kind: 'gift' | 'premium' | 'nft' | null; months: number | null; nft_id: number | null; paid: number;
  admin_chat: string | null; admin_msg: number | null;
}

const getW = (ctx: Ctx, id: string) => ctx.db.prepare('SELECT * FROM withdrawals WHERE id = ?').bind(id).first<WithdrawalRow>();
const nftTitle = async (ctx: Ctx, id: number | null) => (id ? (await ctx.db.prepare('SELECT title FROM nft_stock WHERE id = ?').bind(id).first<{ title: string }>())?.title : null) ?? null;

/** Card for the admin with approve/reject buttons. */
export async function notifyAdminReview(ctx: Ctx, wid: string) {
  const w = await getW(ctx, wid);
  if (!w) return;
  const u = await ctx.db.prepare('SELECT tg_username, tg_first_name, risk_score, flagged, created_at, balance FROM users WHERE id = ?').bind(w.user_id)
    .first<{ tg_username: string | null; tg_first_name: string | null; risk_score: number; flagged: number; created_at: number; balance: number }>();
  const ageH = u ? Math.round((Date.now() - u.created_at) / 3600_000) : 0;
  const who = u?.tg_username ? `@${esc(u.tg_username)}` : esc(u?.tg_first_name || w.user_id);
  const text = `🧾 <b>Вывод на проверку</b>\n${esc(itemName(w.prize_id, await nftTitle(ctx, w.nft_id)))} · ${w.value} ⭐\n`
    + `Игрок: <a href="tg://user?id=${w.user_id}">${who}</a> (${w.user_id})\nРиск: ${u?.risk_score ?? 0}${u?.flagged ? ' 🚩' : ''} · аккаунту ${ageH} ч · баланс ${u?.balance ?? 0} ⭐\nПричина: ${esc(w.reason || '-')}\n<code>${w.id}</code>`;
  const kb = { inline_keyboard: [[{ text: '✅ Одобрить', callback_data: `wa:${w.id}` }, { text: '❌ Отклонить', callback_data: `wr:${w.id}` }]] };
  for (const a of await adminIds(ctx)) {
    try {
      const m = await ctx.tg.call<{ message_id: number }>('sendMessage', { chat_id: Number(a), text, parse_mode: 'HTML', reply_markup: kb });
      await ctx.db.prepare('UPDATE withdrawals SET admin_chat = ?, admin_msg = ? WHERE id = ? AND admin_msg IS NULL').bind(a, m.message_id, w.id).run();
    } catch (e) { log('warn', 'admin_review_notify_failed', { err: String(e) }); }
  }
}

export async function approveWithdrawal(ctx: Ctx, wid: string, by: string): Promise<{ ok: boolean; msg: string; deliveryId?: string }> {
  const res = await withRetry(ctx.db, async (tx) => {
    const w = await getW(ctx, wid);
    if (!w) return { ok: false, msg: 'не найден' };
    if (w.status !== 'review') return { ok: false, msg: `уже ${w.status}` };
    tx.add("INSERT INTO tx_guard (n) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM withdrawals WHERE id = ? AND status = 'review')", wid);
    tx.add("UPDATE withdrawals SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = ?", by, Date.now(), wid);
    const deliveryId = enqueueDelivery(tx, { withdrawalId: wid, userId: w.user_id, kind: w.kind ?? 'gift', prizeId: w.prize_id, months: w.months, nftId: w.nft_id, cost: w.kind === 'premium' ? PREMIUM_STARS[w.months ?? 3] : w.value });
    return { ok: true, msg: 'одобрено', deliveryId };
  });
  if (res.deliveryId) {
    log('info', 'withdrawal_approved', { wid, by });
    ctx.waitUntil(processDelivery(ctx, res.deliveryId).catch((e) => log('error', 'delivery_crash', { err: String(e) })));
  }
  return res;
}

/** Reject (from review or after a failed delivery): item back to inventory / premium refunded. */
export async function rejectWithdrawal(ctx: Ctx, wid: string, by: string): Promise<{ ok: boolean; msg: string }> {
  const ok = ['review', 'approved', 'failed'];
  const res = await withRetry(ctx.db, async (tx) => {
    const w = await getW(ctx, wid);
    if (!w) return { ok: false, msg: 'не найден', w: null };
    if (!ok.includes(w.status)) return { ok: false, msg: `уже ${w.status}`, w: null };
    const d = await ctx.db.prepare('SELECT status FROM deliveries WHERE withdrawal_id = ?').bind(wid).first<{ status: string }>();
    if (d && (d.status === 'delivered' || d.status === 'sending')) return { ok: false, msg: `доставка ${d.status}`, w: null };
    tx.add(`INSERT INTO tx_guard (n) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM withdrawals WHERE id = ? AND status IN ('review','approved','failed'))`, wid);
    tx.add(`INSERT INTO tx_guard (n) SELECT 1 WHERE EXISTS (SELECT 1 FROM deliveries WHERE withdrawal_id = ? AND status IN ('delivered','sending'))`, wid);
    tx.add("UPDATE withdrawals SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ?", by, Date.now(), wid);
    tx.add("UPDATE deliveries SET status = 'cancelled', updated_at = ? WHERE withdrawal_id = ?", Date.now(), wid);
    if (w.item_uid.startsWith('prem:')) creditRelative(tx, w.user_id, w.paid, 'premium_refund', wid);
    else tx.add("UPDATE inventory SET status = 'owned' WHERE uid = ? AND status = 'withdrawing'", w.item_uid);
    return { ok: true, msg: 'отклонено', w };
  });
  if (res.w) {
    log('info', 'withdrawal_rejected', { wid, by });
    const w = res.w;
    if (w.item_uid.startsWith('prem:')) await notifyUser(ctx, w.user_id, 'rejected_premium', { n: w.paid });
    else await notifyUser(ctx, w.user_id, 'rejected_item', { item: itemName(w.prize_id, await nftTitle(ctx, w.nft_id)) });
  }
  return { ok: res.ok, msg: res.msg };
}

/** Admin actions on a problematic delivery. */
export async function retryDelivery(ctx: Ctx, did: string) {
  const r = await ctx.db.prepare(`UPDATE deliveries SET status = 'queued', next_at = 0, admin_notified = 0, updated_at = ?
     WHERE id = ? AND status IN ('failed','unknown','waiting_funds','waiting_business','queued') RETURNING withdrawal_id`).bind(Date.now(), did).first<{ withdrawal_id: string }>();
  if (!r) return { ok: false, msg: 'нельзя повторить' };
  await ctx.db.prepare("UPDATE withdrawals SET status = 'approved' WHERE id = ? AND status = 'failed'").bind(r.withdrawal_id).run();
  const out = await processDelivery(ctx, did);
  return { ok: true, msg: `повтор: ${out}` };
}

export async function markDeliveredManually(ctx: Ctx, did: string) {
  const d = await ctx.db.prepare("SELECT * FROM deliveries WHERE id = ? AND status IN ('unknown','failed','waiting_funds','waiting_business')").bind(did).first<DeliveryRow>();
  if (!d) return { ok: false, msg: 'нельзя' };
  const now = Date.now();
  const w = await getW(ctx, d.withdrawal_id);
  const stmts = [
    ctx.db.prepare("UPDATE deliveries SET status = 'delivered', delivered_at = ?, updated_at = ?, last_error = 'marked_by_admin' WHERE id = ?").bind(now, now, did),
    ctx.db.prepare("UPDATE withdrawals SET status = 'delivered' WHERE id = ?").bind(d.withdrawal_id),
  ];
  if (w && !w.item_uid.startsWith('prem:')) stmts.push(ctx.db.prepare("UPDATE inventory SET status = 'delivered' WHERE uid = ?").bind(w.item_uid));
  if (d.nft_id) stmts.push(ctx.db.prepare("UPDATE nft_stock SET status = 'delivered', delivered_at = ? WHERE id = ?").bind(now, d.nft_id));
  await ctx.db.batch(stmts);
  return { ok: true, msg: 'отмечено доставленным' };
}

export async function rejectByDelivery(ctx: Ctx, did: string, by: string) {
  const d = await ctx.db.prepare('SELECT withdrawal_id, status FROM deliveries WHERE id = ?').bind(did).first<{ withdrawal_id: string; status: string }>();
  if (!d) return { ok: false, msg: 'не найден' };
  if (d.status === 'unknown') {
    // outcome unknown → move to failed first so reject is allowed (admin confirmed it did NOT arrive)
    await ctx.db.prepare("UPDATE deliveries SET status = 'failed' WHERE id = ? AND status = 'unknown'").bind(did).run();
  }
  return rejectWithdrawal(ctx, d.withdrawal_id, by);
}
