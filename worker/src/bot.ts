import { NFT_TIERS, nftTierFor } from './catalog.ts';
import { safeEqualHex, sha256Hex } from './crypto.ts';
import { adminIds, getSetting, isAdmin, ownerConnection, setSetting, type Ctx } from './ctx.ts';
import { log } from './log.ts';
import { applyRefund, checkPreCheckout, creditPayment } from './payments.ts';
import { hitRateLimit } from './risk.ts';
import { esc, itemName, tx as text } from './texts.ts';
import { approveWithdrawal, markDeliveredManually, notifyAdminReview, rejectByDelivery, rejectWithdrawal, retryDelivery } from './withdrawals.ts';

type Any = Record<string, any>;

/** Telegram webhook update entry point. Throws only on transient errors (Telegram will redeliver). */
export async function handleUpdate(ctx: Ctx, update: Any): Promise<unknown> {
  const uid = Number(update.update_id);
  if (Number.isFinite(uid) && uid > 0) {
    const seen = await ctx.db.prepare('SELECT 1 AS x FROM tg_updates WHERE update_id = ?').bind(uid).first();
    if (seen) return { duplicate: true };
  }
  const out = await route(ctx, update);
  if (Number.isFinite(uid) && uid > 0) await ctx.db.prepare('INSERT OR IGNORE INTO tg_updates (update_id, created_at) VALUES (?, ?)').bind(uid, Date.now()).run();
  return out;
}

async function route(ctx: Ctx, update: Any): Promise<unknown> {
  const msg: Any | undefined = update.message;
  const pay = msg?.successful_payment ?? update.successful_payment;
  if (pay) return creditPayment(ctx, pay, msg?.from?.id);
  const ref = msg?.refunded_payment ?? update.refunded_payment;
  if (ref) {
    if (!ref.telegram_payment_charge_id) return { ignored: true };
    return applyRefund(ctx, ref.telegram_payment_charge_id, Number(ref.total_amount) || 0);
  }
  if (update.pre_checkout_query) {
    const q = update.pre_checkout_query;
    const err = await checkPreCheckout(ctx, q);
    await ctx.tg.call('answerPreCheckoutQuery', err ? { pre_checkout_query_id: q.id, ok: false, error_message: 'Счёт устарел, создайте новый в приложении' } : { pre_checkout_query_id: q.id, ok: true });
    log('info', 'pre_checkout', { ok: !err, reason: err });
    return { preCheckout: err ? 'rejected' : 'ok' };
  }
  if (update.business_connection) return saveBusinessConnection(ctx, update.business_connection);
  if (update.callback_query) return onCallback(ctx, update.callback_query);
  if (msg?.text && msg.chat?.type === 'private') return onText(ctx, msg);
  return { ignored: true };
}

async function saveBusinessConnection(ctx: Ctx, c: Any) {
  await ctx.db.prepare(`INSERT INTO business_connections (id, user_id, user_chat_id, enabled, rights, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, rights = excluded.rights, updated_at = excluded.updated_at`)
    .bind(c.id, String(c.user?.id ?? ''), String(c.user_chat_id ?? ''), c.is_enabled ? 1 : 0, JSON.stringify(c.rights ?? {}), Date.now()).run();
  const admin = await isAdmin(ctx, c.user?.id ?? '');
  log('info', 'business_connection', { enabled: !!c.is_enabled, admin, transfer: !!c.rights?.can_transfer_and_upgrade_gifts });
  if (admin && c.user_chat_id) {
    const r = c.rights ?? {};
    const need = ['can_view_gifts_and_stars', 'can_transfer_and_upgrade_gifts', 'can_transfer_stars'].filter((k) => !r[k]);
    await send(ctx, c.user_chat_id, c.is_enabled
      ? (need.length ? `🔗 Business подключён, но не хватает прав: ${need.join(', ')}. Включите их в Настройки → Telegram для бизнеса → Чат-боты.` : '🔗 Business подключён со всеми правами. NFT из вашего профиля можно добавлять в кейсы: /nft_sync')
      : '🔌 Business-подключение выключено — NFT-призы будут ждать доставки.');
  }
  return { business: true };
}

function send(ctx: Ctx, chatId: number | string, body: string, extra: Any = {}) {
  return ctx.tg.call('sendMessage', { chat_id: Number(chatId), text: body, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra })
    .catch((e) => log('warn', 'send_failed', { err: String(e) }));
}

async function onText(ctx: Ctx, msg: Any) {
  const from = msg.from ?? {};
  const fromId = String(from.id);
  const [cmdRaw, ...args] = String(msg.text).trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@\w+$/, '');
  await ctx.db.prepare('UPDATE users SET lang = COALESCE(?, lang), tg_username = ?, tg_first_name = ? WHERE id = ?')
    .bind(from.language_code ?? null, from.username ?? null, from.first_name ?? null, fromId).run();
  const playKb = { inline_keyboard: [[{ text: `👻 ${text(from.language_code, 'play')}`, web_app: { url: ctx.cfg.webAppUrl } }]] };

  if (cmd === '/start') { await send(ctx, msg.chat.id, text(from.language_code, 'welcome'), { reply_markup: playKb }); return { start: true }; }
  if (cmd === '/help') { await send(ctx, msg.chat.id, text(from.language_code, 'help'), { reply_markup: playKb }); return { help: true }; }
  if (cmd === '/admin' && !(await isAdmin(ctx, fromId))) return claimAdmin(ctx, msg.chat.id, from, args[0] ?? '');
  if (cmd.startsWith('/') && (await isAdmin(ctx, fromId))) return adminCommand(ctx, msg.chat.id, fromId, cmd, args);
  if (cmd.startsWith('/')) { await send(ctx, msg.chat.id, text(from.language_code, 'help'), { reply_markup: playKb }); return { unknown: true }; }
  return { ignored: true };
}

async function claimAdmin(ctx: Ctx, chatId: number, from: Any, code: string) {
  const fromId = String(from.id);
  const want = ctx.cfg.adminClaimCode;
  if (code && want && !(await hitRateLimit(ctx.db, `claim:${fromId}`, 5, 3600_000))) {
    const okCode = safeEqualHex(await sha256Hex(code), await sha256Hex(want));
    const existing = await getSetting(ctx.db, 'admin_id');
    if (okCode && !existing) {
      await setSetting(ctx.db, 'admin_id', fromId);
      log('info', 'admin_claimed', { admin: fromId });
      await send(ctx, chatId, `✅ Вы админ Ghost Gift.\n\n${ADMIN_HELP}`);
      return { claim: 'ok' };
    }
    if (!okCode) log('warn', 'admin_claim_bad_code', { from: fromId });
  }
  // No (valid) code: record a request for the operator (scripts/promote-admin.sh).
  await ctx.db.prepare(`INSERT INTO admin_requests (tg_id, username, first_name, requested_at, attempts, status) VALUES (?, ?, ?, ?, 1, 'pending')
    ON CONFLICT(tg_id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name, requested_at = excluded.requested_at,
      attempts = admin_requests.attempts + 1, status = CASE WHEN admin_requests.status = 'promoted' THEN 'pending' ELSE admin_requests.status END`)
    .bind(fromId, from.username ?? null, from.first_name ?? null, Date.now()).run();
  log('info', 'admin_request', { from: fromId });
  await send(ctx, chatId, 'Запрос отправлен');
  return { claim: 'requested' };
}

const ADMIN_HELP = `<b>Админ-команды</b>
/queue — выводы на проверке
/deliveries — проблемные доставки
/stats — банк, звёзды бота, игроки
/nft — склад NFT
/nft_sync — NFT в вашем Business-аккаунте
/nft_add &lt;owned_gift_id&gt; &lt;цена⭐&gt; — добавить NFT в кейсы
/nft_rm &lt;id&gt; — убрать NFT со склада
/luck &lt;user_id&gt; &lt;0-10&gt; — карта удачи игроку`;

async function adminCommand(ctx: Ctx, chatId: number, adminId: string, cmd: string, args: string[]) {
  const db = ctx.db;
  switch (cmd) {
    case '/admin': case '/start_admin': await send(ctx, chatId, ADMIN_HELP); return { admin: 'help' };
    case '/queue': {
      const rows = await db.prepare("SELECT id FROM withdrawals WHERE status = 'review' ORDER BY created_at LIMIT 10").all<{ id: string }>();
      if (!rows.results?.length) { await send(ctx, chatId, 'Очередь пуста ✨'); return { queue: 0 }; }
      for (const r of rows.results) await notifyAdminReview(ctx, r.id);
      return { queue: rows.results.length };
    }
    case '/deliveries': {
      const rows = await db.prepare("SELECT id, prize_id, user_id, status, last_error, attempts FROM deliveries WHERE status IN ('failed','unknown','waiting_funds','waiting_business','queued') ORDER BY updated_at DESC LIMIT 10")
        .all<{ id: string; prize_id: string; user_id: string; status: string; last_error: string | null; attempts: number }>();
      if (!rows.results?.length) { await send(ctx, chatId, 'Проблемных доставок нет ✨'); return { deliveries: 0 }; }
      for (const d of rows.results) {
        await send(ctx, chatId, `📦 <code>${d.id}</code> · ${esc(itemName(d.prize_id))} → ${d.user_id}\n${d.status} · ${esc(d.last_error || '')} · попыток ${d.attempts}`,
          { reply_markup: { inline_keyboard: [[{ text: '🔁 Повторить', callback_data: `dr:${d.id}` }, { text: '✅ Доставлено', callback_data: `dd:${d.id}` }, { text: '✖ Отклонить', callback_data: `dx:${d.id}` }]] } });
      }
      return { deliveries: rows.results.length };
    }
    case '/stats': {
      const day = Date.now() - 86400_000;
      const [bank, users, opens, deps, dl, wq, nft] = await db.batch([
        db.prepare('SELECT balance, big_prizes_today, day FROM bank WHERE id = 1'),
        db.prepare('SELECT COUNT(*) AS n, SUM(balance) AS bal, SUM(CASE WHEN last_seen > ? THEN 1 ELSE 0 END) AS active FROM users').bind(day),
        db.prepare('SELECT COUNT(*) AS n FROM fairness_log WHERE created_at > ?').bind(day),
        db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(stars),0) AS s FROM payments WHERE created_at > ? AND refunded = 0').bind(day),
        db.prepare("SELECT status, COUNT(*) AS n FROM deliveries WHERE status != 'delivered' AND status != 'cancelled' GROUP BY status"),
        db.prepare("SELECT COUNT(*) AS n FROM withdrawals WHERE status = 'review'"),
        db.prepare('SELECT status, COUNT(*) AS n FROM nft_stock GROUP BY status'),
      ]);
      let stars = '?';
      try { stars = String((await ctx.tg.call<{ amount: number }>('getMyStarBalance')).amount); } catch { /* shown as ? */ }
      const b = bank.results?.[0] as Any ?? {};
      const u = users.results?.[0] as Any ?? {};
      const conn = await ownerConnection(ctx);
      const lines = [
        '📊 <b>Ghost Gift</b>',
        `⭐ Звёзды бота: <b>${stars}</b>`,
        `🏦 Банк: ${b.balance ?? 0} · крупных сегодня ${b.big_prizes_today ?? 0}/${ctx.cfg.dailyBigPrizeCap} · резерв ${ctx.cfg.bankReserve}`,
        `👥 Игроков: ${u.n ?? 0} (активны 24ч: ${u.active ?? 0}) · на балансах ${u.bal ?? 0} ⭐`,
        `🎰 Открытий 24ч: ${(opens.results?.[0] as Any)?.n ?? 0}`,
        `💳 Пополнений 24ч: ${(deps.results?.[0] as Any)?.n ?? 0} на ${(deps.results?.[0] as Any)?.s ?? 0} ⭐`,
        `🧾 На проверке: ${(wq.results?.[0] as Any)?.n ?? 0}`,
        `📦 Доставки: ${(dl.results as Any[] ?? []).map((r) => `${r.status} ${r.n}`).join(', ') || 'нет'}`,
        `💎 NFT: ${(nft.results as Any[] ?? []).map((r) => `${r.status} ${r.n}`).join(', ') || 'пусто'}`,
        `🔗 Business: ${conn ? 'подключён' : 'не подключён'}`,
      ];
      await send(ctx, chatId, lines.join('\n'));
      return { stats: true };
    }
    case '/nft': {
      const rows = await db.prepare("SELECT id, title, name, value, tier, status FROM nft_stock WHERE status != 'removed' ORDER BY value DESC LIMIT 50").all<Any>();
      const list = (rows.results ?? []).map((r) => `#${r.id} <a href="https://t.me/nft/${esc(r.name)}">${esc(r.title)}</a> · ${r.value}⭐ · ${r.tier} · ${r.status}`);
      await send(ctx, chatId, list.length ? `💎 <b>Склад NFT</b>\n${list.join('\n')}` : 'Склад NFT пуст. /nft_sync — посмотреть NFT в Business-аккаунте.');
      return { nft: list.length };
    }
    case '/nft_sync': {
      const conn = await ownerConnection(ctx);
      if (!conn) { await send(ctx, chatId, BUSINESS_HOWTO); return { nftSync: 'no_connection' }; }
      const gifts = await listUniqueGifts(ctx, conn.id);
      const stocked = new Set(((await db.prepare("SELECT owned_gift_id FROM nft_stock WHERE status != 'removed'").all<{ owned_gift_id: string }>()).results ?? []).map((r) => r.owned_gift_id));
      const lines = gifts.map((g) => `${stocked.has(g.owned_gift_id) ? '✅' : '➕'} <a href="https://t.me/nft/${esc(g.name)}">${esc(g.title)}</a> · перевод ${g.transfer_star_count ?? 0}⭐${g.can_be_transferred === false ? ' · нельзя передать' : ''}\n<code>/nft_add ${g.owned_gift_id} ЦЕНА</code>`);
      await send(ctx, chatId, lines.length ? `💎 NFT в Business-аккаунте (цена — в звёздах, диапазоны: S ${NFT_TIERS.nft_s.min}–${NFT_TIERS.nft_s.max}, M ${NFT_TIERS.nft_m.min}–${NFT_TIERS.nft_m.max}, L ${NFT_TIERS.nft_l.min}–${NFT_TIERS.nft_l.max})\n\n${lines.join('\n\n')}` : 'В Business-аккаунте нет передаваемых NFT.');
      return { nftSync: gifts.length };
    }
    case '/nft_add': {
      const [ownedId, valueRaw] = args;
      const value = Number(valueRaw);
      const tier = nftTierFor(value);
      if (!ownedId || !tier) { await send(ctx, chatId, `Формат: /nft_add &lt;owned_gift_id&gt; &lt;цена⭐&gt;; цена ${NFT_TIERS.nft_s.min}–${NFT_TIERS.nft_l.max}`); return { nftAdd: 'bad' }; }
      const conn = await ownerConnection(ctx);
      if (!conn) { await send(ctx, chatId, BUSINESS_HOWTO); return { nftAdd: 'no_connection' }; }
      const g = (await listUniqueGifts(ctx, conn.id)).find((x) => x.owned_gift_id === ownedId);
      if (!g) { await send(ctx, chatId, 'NFT с таким owned_gift_id не найден в Business-аккаунте (/nft_sync).'); return { nftAdd: 'missing' }; }
      if (g.can_be_transferred === false) { await send(ctx, chatId, 'Этот NFT нельзя передать.'); return { nftAdd: 'locked' }; }
      await db.prepare(`INSERT INTO nft_stock (owned_gift_id, name, title, value, tier, transfer_cost, status, added_at) VALUES (?, ?, ?, ?, ?, ?, 'in_stock', ?)
        ON CONFLICT(owned_gift_id) DO UPDATE SET value = excluded.value, tier = excluded.tier, transfer_cost = excluded.transfer_cost, status = CASE WHEN nft_stock.status = 'removed' THEN 'in_stock' ELSE nft_stock.status END`)
        .bind(ownedId, g.name, g.title, value, tier, g.transfer_star_count ?? 0, Date.now()).run();
      log('info', 'nft_added', { ownedId, value, tier });
      await send(ctx, chatId, `✅ ${esc(g.title)} добавлен: ${value}⭐, уровень ${tier}. Он появится в кейсах этого уровня.`);
      return { nftAdd: 'ok', tier };
    }
    case '/nft_rm': {
      const r = await db.prepare("UPDATE nft_stock SET status = 'removed' WHERE id = ? AND status = 'in_stock' RETURNING title").bind(Number(args[0])).first<{ title: string }>();
      await send(ctx, chatId, r ? `Убран: ${esc(r.title)}` : 'Нельзя: NFT не найден или уже выпал игроку.');
      return { nftRm: !!r };
    }
    case '/luck': {
      const [userId, pctRaw] = args;
      const pct = Math.max(0, Math.min(10, Math.round(Number(pctRaw) || 0)));
      const r = await db.prepare('UPDATE users SET luck_pct = ? WHERE id = ? RETURNING id').bind(pct, String(userId)).first();
      await send(ctx, chatId, r ? `🍀 Карта удачи ${pct}% выдана ${esc(String(userId))} (действует на кейсы до 50⭐).` : 'Игрок не найден.');
      return { luck: !!r };
    }
    default: await send(ctx, chatId, ADMIN_HELP); return { admin: 'help' };
  }
}

const BUSINESS_HOWTO = `🔗 <b>Business не подключён.</b> Чтобы бот мог передавать NFT:
1. @BotFather → /mybots → Ghost Gift → Bot Settings → Business Mode → Turn on.
2. В Telegram: Настройки → Telegram для бизнеса → Чат-боты → добавьте @GhostGift_Game.
3. Включите права: «Подарки и звёзды» (просмотр, передача и улучшение подарков, передача звёзд).
NFT должны лежать в вашем профиле; плата за передачу списывается со звёзд Business-аккаунта.`;

async function listUniqueGifts(ctx: Ctx, connId: string) {
  const out: { owned_gift_id: string; name: string; title: string; transfer_star_count?: number; can_be_transferred?: boolean }[] = [];
  let offset = '';
  for (let page = 0; page < 5; page++) {
    const r = await ctx.tg.call<{ gifts: Any[]; next_offset?: string }>('getBusinessAccountGifts', {
      business_connection_id: connId, exclude_unlimited: true, exclude_limited_upgradable: true, exclude_limited_non_upgradable: true, exclude_from_blockchain: true, offset, limit: 100,
    });
    for (const g of r.gifts ?? []) {
      if (g.type !== 'unique' || !g.owned_gift_id) continue;
      out.push({ owned_gift_id: g.owned_gift_id, name: g.gift?.name ?? '', title: `${g.gift?.base_name ?? 'NFT'} #${g.gift?.number ?? ''}`, transfer_star_count: g.transfer_star_count, can_be_transferred: g.can_be_transferred });
    }
    if (!r.next_offset) break;
    offset = r.next_offset;
  }
  return out;
}

async function onCallback(ctx: Ctx, q: Any) {
  const fromId = String(q.from?.id ?? '');
  const answer = (t: string) => ctx.tg.call('answerCallbackQuery', { callback_query_id: q.id, text: t }).catch(() => {});
  if (!(await isAdmin(ctx, fromId))) { await answer('Нет доступа'); return { callback: 'denied' }; }
  const [act, id] = String(q.data ?? '').split(':');
  let res: { ok: boolean; msg: string };
  switch (act) {
    case 'wa': res = await approveWithdrawal(ctx, id, fromId); break;
    case 'wr': res = await rejectWithdrawal(ctx, id, fromId); break;
    case 'dr': res = await retryDelivery(ctx, id); break;
    case 'dd': res = await markDeliveredManually(ctx, id); break;
    case 'dx': res = await rejectByDelivery(ctx, id, fromId); break;
    default: res = { ok: false, msg: '?' };
  }
  await answer(res.msg);
  if (res.ok && q.message) {
    const who = q.from?.username ? `@${q.from.username}` : fromId;
    await ctx.tg.call('editMessageText', {
      chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML',
      text: `${esc(q.message.text ?? '')}\n\n<b>→ ${esc(res.msg)}</b> (${esc(who)})`,
    }).catch(() => {});
  }
  log('info', 'admin_action', { act, id, ok: res.ok });
  return { callback: act, ...res };
}

export { adminIds };
