import { GIFT_EMOJI, PRIZES } from './catalog.ts';
import { randomHex } from './crypto.ts';
import type { Tx } from './db.ts';
import { adminIds, ownerConnection, type Ctx } from './ctx.ts';
import { log } from './log.ts';
import { TgError } from './telegram.ts';
import { esc, itemName, tx as text } from './texts.ts';
import { nftCollection } from './catalog.ts';

export const PREMIUM_STARS: Record<number, number> = { 3: 1000, 6: 1500, 12: 2500 };
const MAX_ATTEMPTS = 8;
const RETRY_STATES = ['queued', 'waiting_funds', 'waiting_business'];

export interface DeliveryRow {
  id: string; withdrawal_id: string; user_id: string; kind: 'gift' | 'premium' | 'nft'; prize_id: string;
  months: number | null; nft_id: number | null; cost: number; status: string; attempts: number; next_at: number;
  last_error: string | null; admin_notified: number;
}

/** Queue a delivery inside the caller's atomic batch. */
export function enqueueDelivery(tx: Tx, d: { withdrawalId: string; userId: string; kind: DeliveryRow['kind']; prizeId: string; months?: number | null; nftId?: number | null; cost: number }) {
  const id = randomHex(8);
  const now = Date.now();
  tx.add(`INSERT INTO deliveries (id, withdrawal_id, user_id, kind, prize_id, months, nft_id, cost, status, attempts, next_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, 0, ?, ?)`, id, d.withdrawalId, d.userId, d.kind, d.prizeId, d.months ?? null, d.nftId ?? null, d.cost, now, now);
  return id;
}

// getAvailableGifts cache (per isolate)
let giftCache: { at: number; gifts: { id: string; star_count: number; sticker?: { emoji?: string }; remaining_count?: number; total_count?: number }[] } | null = null;
async function resolveGift(ctx: Ctx, prizeId: string) {
  if (!giftCache || Date.now() - giftCache.at > 10 * 60_000) {
    const r = await ctx.tg.call<{ gifts: NonNullable<typeof giftCache>['gifts'] }>('getAvailableGifts');
    giftCache = { at: Date.now(), gifts: r.gifts ?? [] };
  }
  const emoji = GIFT_EMOJI[prizeId];
  const value = PRIZES[prizeId]?.value ?? 0;
  const cands = giftCache.gifts.filter((g) => g.sticker?.emoji === emoji && !(g.total_count && !g.remaining_count));
  return cands.find((g) => g.star_count === value) ?? cands.sort((a, b) => a.star_count - b.star_count)[0] ?? null;
}
export function resetGiftCache() { giftCache = null; }

async function botStars(ctx: Ctx): Promise<number> {
  const r = await ctx.tg.call<{ amount: number }>('getMyStarBalance');
  return r.amount ?? 0;
}

/** Process one delivery (atomic claim → Telegram call → final state). Safe to call concurrently. */
export async function processDelivery(ctx: Ctx, id: string): Promise<string> {
  const now = Date.now();
  const d = await ctx.db.prepare(`UPDATE deliveries SET status = 'sending', attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND status IN ('queued', 'waiting_funds', 'waiting_business') AND next_at <= ? RETURNING *`)
    .bind(now, id, now).first<DeliveryRow>();
  if (!d) return 'skipped';
  const nft = d.nft_id ? await ctx.db.prepare('SELECT * FROM nft_stock WHERE id = ?').bind(d.nft_id).first<{ owned_gift_id: string; name: string; title: string; transfer_cost: number }>() : null;
  const name = itemName(d.prize_id, nft?.title);
  try {
    if (d.kind === 'gift') {
      const gift = await resolveGift(ctx, d.prize_id);
      if (!gift) return fail(ctx, d, 'failed', 'gift_unavailable');
      if (gift.star_count > (PRIZES[d.prize_id]?.value ?? 0) * 1.5) return fail(ctx, d, 'failed', `gift_price_changed:${gift.star_count}`);
      if ((await botStars(ctx)) < gift.star_count) return wait(ctx, d, 'waiting_funds', 'bot_star_balance_low', 15 * 60_000);
      await ctx.tg.call('sendGift', { user_id: Number(d.user_id), gift_id: gift.id, text: 'Ghost Gift 👻' }, { money: true });
      await markDelivered(ctx, d, gift.star_count);
      await notifyUser(ctx, d.user_id, 'delivered_gift', { item: name });
    } else if (d.kind === 'premium') {
      const months = d.months ?? 3;
      const stars = PREMIUM_STARS[months];
      if (!stars) return fail(ctx, d, 'failed', 'bad_months');
      if ((await botStars(ctx)) < stars) return wait(ctx, d, 'waiting_funds', 'bot_star_balance_low', 15 * 60_000);
      await ctx.tg.call('giftPremiumSubscription', { user_id: Number(d.user_id), month_count: months, star_count: stars, text: 'Ghost Gift 👻' }, { money: true });
      await markDelivered(ctx, d, stars);
      await notifyUser(ctx, d.user_id, 'delivered_premium', { m: months });
    } else {
      if (!nft) return fail(ctx, d, 'failed', 'nft_missing');
      if (ctx.cfg.nftDelivery === 'manual') {
        // Hand delivery: park it as 'manual' (cron ignores it), DM the admin a card with Выдано / Отклонить.
        await ctx.db.prepare("UPDATE deliveries SET status = 'manual', last_error = NULL, updated_at = ? WHERE id = ?").bind(Date.now(), d.id).run();
        await notifyAdminManualNft(ctx, d.id);
        await notifyUser(ctx, d.user_id, 'nft_sending', { item: name });
        log('info', 'delivery_manual', { id: d.id, prize: d.prize_id, user: d.user_id });
        return 'manual';
      }
      const conn = await ownerConnection(ctx);
      if (!conn) return wait(ctx, d, 'waiting_business', 'business_not_connected', 30 * 60_000);
      const owned = await findOwnedUnique(ctx, conn.id, nft.owned_gift_id);
      if (!owned) return fail(ctx, d, 'failed', 'nft_not_in_business_account');
      if (owned.next_transfer_date && owned.next_transfer_date * 1000 > Date.now()) {
        return wait(ctx, d, 'waiting_business', `nft_transfer_locked_until:${owned.next_transfer_date}`, Math.min(6 * 3600_000, owned.next_transfer_date * 1000 - Date.now() + 60_000));
      }
      const cost = owned.transfer_star_count ?? 0;
      if (cost > 0 && !conn.rights.can_transfer_stars) return wait(ctx, d, 'waiting_business', 'need_can_transfer_stars_right', 30 * 60_000);
      await ctx.tg.call('transferGift', { business_connection_id: conn.id, owned_gift_id: nft.owned_gift_id, new_owner_chat_id: Number(d.user_id), ...(cost > 0 ? { star_count: cost } : {}) }, { money: true });
      await markDelivered(ctx, d, cost);
      await notifyUser(ctx, d.user_id, 'delivered_nft', { item: name });
    }
    log('info', 'delivery_done', { id: d.id, kind: d.kind, prize: d.prize_id, user: d.user_id });
    return 'delivered';
  } catch (e) {
    const err = e instanceof TgError ? e : new TgError(0, e instanceof Error ? e.message : 'error', 0, true);
    log('warn', 'delivery_error', { id: d.id, kind: d.kind, code: err.code, desc: err.description });
    if (err.network) return fail(ctx, d, 'unknown', `network:${err.description}`); // may have been sent: admin decides
    if (err.code === 429) return wait(ctx, d, 'queued', 'flood', Math.max(5, err.retryAfter) * 1000);
    if (/BALANCE|not enough|STARS_NOT_ENOUGH|insufficient/i.test(err.description)) return wait(ctx, d, 'waiting_funds', err.description, 15 * 60_000);
    if (err.code >= 500 && d.attempts < MAX_ATTEMPTS) return wait(ctx, d, 'queued', err.description, Math.min(3600_000, 60_000 * 2 ** d.attempts));
    return fail(ctx, d, 'failed', `${err.code}:${err.description}`);
  }
}

async function findOwnedUnique(ctx: Ctx, connId: string, ownedGiftId: string) {
  let offset = '';
  for (let page = 0; page < 5; page++) {
    const r = await ctx.tg.call<{ gifts: { type: string; owned_gift_id?: string; transfer_star_count?: number; next_transfer_date?: number; can_be_transferred?: boolean }[]; next_offset?: string }>(
      'getBusinessAccountGifts', { business_connection_id: connId, exclude_unlimited: true, exclude_limited_upgradable: true, exclude_limited_non_upgradable: true, exclude_from_blockchain: true, offset, limit: 100 });
    const hit = (r.gifts ?? []).find((g) => g.owned_gift_id === ownedGiftId);
    if (hit) return hit.can_be_transferred === false ? null : hit;
    if (!r.next_offset) break;
    offset = r.next_offset;
  }
  return null;
}

async function markDelivered(ctx: Ctx, d: DeliveryRow, cost: number) {
  const now = Date.now();
  const w = await ctx.db.prepare('SELECT item_uid FROM withdrawals WHERE id = ?').bind(d.withdrawal_id).first<{ item_uid: string }>();
  const stmts = [
    ctx.db.prepare("UPDATE deliveries SET status = 'delivered', cost = ?, delivered_at = ?, updated_at = ?, last_error = NULL WHERE id = ?").bind(cost, now, now, d.id),
    ctx.db.prepare("UPDATE withdrawals SET status = 'delivered' WHERE id = ?").bind(d.withdrawal_id),
  ];
  if (w?.item_uid && !w.item_uid.startsWith('prem:')) stmts.push(ctx.db.prepare("UPDATE inventory SET status = 'delivered' WHERE uid = ?").bind(w.item_uid));
  if (d.nft_id) stmts.push(ctx.db.prepare("UPDATE nft_stock SET status = 'delivered', delivered_at = ? WHERE id = ?").bind(now, d.nft_id));
  await ctx.db.batch(stmts);
}

async function wait(ctx: Ctx, d: DeliveryRow, status: string, reason: string, delayMs: number) {
  const now = Date.now();
  await ctx.db.prepare('UPDATE deliveries SET status = ?, next_at = ?, last_error = ?, updated_at = ? WHERE id = ?').bind(status, now + delayMs, reason.slice(0, 200), now, d.id).run();
  if (status !== 'queued' && !d.admin_notified) await alertAdmin(ctx, d, `⏸ Доставка ждёт: <b>${esc(reason)}</b>`);
  return status;
}

async function fail(ctx: Ctx, d: DeliveryRow, status: 'failed' | 'unknown', reason: string) {
  const now = Date.now();
  await ctx.db.prepare('UPDATE deliveries SET status = ?, last_error = ?, updated_at = ? WHERE id = ?').bind(status, reason.slice(0, 200), now, d.id).run();
  await ctx.db.prepare("UPDATE withdrawals SET status = 'failed' WHERE id = ? AND status = 'approved'").bind(d.withdrawal_id).run();
  await alertAdmin(ctx, d, status === 'unknown'
    ? `⚠️ Результат отправки неизвестен (<code>${esc(reason)}</code>). Проверьте, дошёл ли подарок, и выберите действие.`
    : `❌ Доставка не удалась: <code>${esc(reason)}</code>`, true);
  return status;
}

export async function alertAdmin(ctx: Ctx, d: DeliveryRow, line: string, force = false) {
  if (d.admin_notified && !force) return;
  const admins = await adminIds(ctx);
  const nft = d.nft_id ? await ctx.db.prepare('SELECT title FROM nft_stock WHERE id = ?').bind(d.nft_id).first<{ title: string }>() : null;
  const textBody = `${line}\n\nДоставка <code>${d.id}</code> · ${esc(itemName(d.prize_id, nft?.title))} → <a href="tg://user?id=${d.user_id}">${d.user_id}</a> · попытка ${d.attempts}`;
  const kb = { inline_keyboard: [[{ text: '🔁 Повторить', callback_data: `dr:${d.id}` }, { text: '✅ Доставлено', callback_data: `dd:${d.id}` }, { text: '✖ Отклонить', callback_data: `dx:${d.id}` }]] };
  for (const a of admins) {
    try { await ctx.tg.call('sendMessage', { chat_id: Number(a), text: textBody, parse_mode: 'HTML', reply_markup: kb }); } catch (e) { log('warn', 'admin_notify_failed', { err: String(e) }); }
  }
  await ctx.db.prepare('UPDATE deliveries SET admin_notified = 1 WHERE id = ?').bind(d.id).run();
}

export async function notifyUser(ctx: Ctx, userId: string, key: Parameters<typeof text>[1], vars: Record<string, string | number>) {
  const u = await ctx.db.prepare('SELECT lang FROM users WHERE id = ?').bind(userId).first<{ lang: string | null }>();
  try {
    await ctx.tg.call('sendMessage', { chat_id: Number(userId), text: text(u?.lang, key, vars), parse_mode: 'HTML' });
  } catch (e) {
    log('info', 'user_notify_failed', { user: userId, err: e instanceof TgError ? e.code : 'x' }); // user may not have started the bot
  }
}

/** Cron: deliver everything due, flag stuck sends, clean old rows. */
export async function cronTick(ctx: Ctx, limit = 5) {
  const now = Date.now();
  const stuck = await ctx.db.prepare("SELECT * FROM deliveries WHERE status = 'sending' AND updated_at < ? LIMIT 10").bind(now - 10 * 60_000).all<DeliveryRow>();
  for (const d of stuck.results ?? []) await fail(ctx, d, 'unknown', 'stuck_in_sending');
  const due = await ctx.db.prepare(`SELECT id FROM deliveries WHERE status IN (${RETRY_STATES.map(() => '?').join(',')}) AND next_at <= ? ORDER BY next_at LIMIT ?`)
    .bind(...RETRY_STATES, now, limit).all<{ id: string }>();
  const results: string[] = [];
  for (const r of due.results ?? []) results.push(await processDelivery(ctx, r.id));
  await ctx.db.batch([
    ctx.db.prepare('DELETE FROM idempotency WHERE created_at < ?').bind(now - 7 * 86400_000),
    ctx.db.prepare('DELETE FROM rate WHERE window_start < ?').bind(now - 86400_000),
    ctx.db.prepare('DELETE FROM tg_updates WHERE created_at < ?').bind(now - 3 * 86400_000),
    ctx.db.prepare("UPDATE invoices SET status = 'expired' WHERE status = 'pending' AND created_at < ?").bind(now - 2 * 86400_000),
  ]);
  log('info', 'cron', { delivered: results.filter((x) => x === 'delivered').length, processed: results.length, stuck: stuck.results?.length ?? 0 });
  return results;
}

/** Admin card for a hand-delivered NFT: who, what, where to buy, and the two decisions. */
export async function notifyAdminManualNft(ctx: Ctx, did: string) {
  const d = await ctx.db.prepare('SELECT * FROM deliveries WHERE id = ?').bind(did).first<DeliveryRow>();
  if (!d) return;
  const [w, nft, u, dep] = await Promise.all([
    ctx.db.prepare('SELECT value, reason FROM withdrawals WHERE id = ?').bind(d.withdrawal_id).first<{ value: number; reason: string | null }>(),
    d.nft_id ? ctx.db.prepare('SELECT title, name FROM nft_stock WHERE id = ?').bind(d.nft_id).first<{ title: string; name: string }>() : null,
    ctx.db.prepare('SELECT tg_username, tg_first_name, risk_score, flagged, created_at, stats_opens FROM users WHERE id = ?').bind(d.user_id)
      .first<{ tg_username: string | null; tg_first_name: string | null; risk_score: number; flagged: number; created_at: number; stats_opens: number }>(),
    ctx.db.prepare('SELECT COALESCE(SUM(stars), 0) AS s FROM payments WHERE user_id = ? AND refunded = 0').bind(d.user_id).first<{ s: number }>(),
  ]);
  const col = nftCollection(d.prize_id);
  const value = w?.value ?? col?.value ?? 0;
  const who = u?.tg_username ? `@${esc(u.tg_username)}` : esc(u?.tg_first_name || d.user_id);
  const ageH = u ? Math.round((Date.now() - u.created_at) / 3600_000) : 0;
  const concrete = nft?.name ? `<a href="https://t.me/nft/${esc(nft.name)}">${esc(nft.title)}</a>` : null;
  const how = concrete
    ? `Передай ${concrete} из своего профиля этому игроку.`
    : `Купи любой <b>${esc(col?.title ?? 'NFT')}</b> по флору (≈ ${col?.floorTon ?? '?'}–${col?.fragmentTon ?? '?'} TON) и передай игроку.`;
  const body = `💎 <b>Выдай NFT вручную</b>\n`
    + `🎁 ${esc(itemName(d.prize_id, nft?.title ?? col?.title))} · <b>${value} ⭐</b>\n`
    + `👤 Кому: <a href="tg://user?id=${d.user_id}">${who}</a> (<code>${d.user_id}</code>)\n`
    + `📊 Риск ${u?.risk_score ?? 0}${u?.flagged ? ' 🚩' : ''} · аккаунту ${ageH} ч · открытий ${u?.stats_opens ?? 0} · пополнил ${dep?.s ?? 0} ⭐${w?.reason ? ` · ${esc(w.reason)}` : ''}\n\n`
    + `${how}\nПотом нажми «✅ Выдано» — игроку придёт уведомление. «Отклонить» вернёт ему ${value} ⭐ на баланс.\n<code>${d.id}</code>`;
  const rows: { text: string; callback_data?: string; url?: string }[][] = [
    [{ text: '✅ Выдано', callback_data: `dd:${d.id}` }, { text: `↩️ Отклонить (+${value}⭐)`, callback_data: `dx:${d.id}` }],
  ];
  if (col && !concrete) rows.push([{ text: `🛒 ${col.title} на Fragment`, url: `https://fragment.com/gifts/${col.slug}?sort=price_asc` }]);
  for (const a of await adminIds(ctx)) {
    try { await ctx.tg.call('sendMessage', { chat_id: Number(a), text: body, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: rows } }); }
    catch (e) { log('warn', 'admin_manual_nft_notify_failed', { err: String(e) }); }
  }
  await ctx.db.prepare('UPDATE deliveries SET admin_notified = 1 WHERE id = ?').bind(d.id).run();
}
