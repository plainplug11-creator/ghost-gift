import { NFT_COLLECTIONS, NFT_DROPS, nftCollection, nftCollectionByName } from './catalog.ts';
import { safeEqualHex, sha256Hex } from './crypto.ts';
import { adminIds, getSetting, isAdmin, ownerConnection, setSetting, type Ctx } from './ctx.ts';
import { log } from './log.ts';
import { applyRefund, checkPreCheckout, creditPayment } from './payments.ts';
import { hitRateLimit } from './risk.ts';
import { esc, itemName, tx as text } from './texts.ts';
import { attachReferral } from './features.ts';
import { levelInfo, parseRef, refLink } from './games-rules.ts';
import { getOrCreateUser } from './users.ts';
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

  const L = from.language_code;
  const wa = (q = '') => ({ url: ctx.cfg.webAppUrl + q });
  const menuKb = { inline_keyboard: [
    [{ text: `👻 ${text(L, 'play')}`, web_app: wa() }],
    [{ text: text(L, 'btn_daily'), web_app: wa('?push=daily') }, { text: text(L, 'btn_wheel'), web_app: wa('?push=wheel') }],
    [{ text: text(L, 'btn_invite'), callback_data: 'u:ref' }, { text: text(L, 'btn_help'), callback_data: 'u:help' }],
  ] };
  if (cmd === '/start') {
    await startUser(ctx, fromId, args[0] ?? '');
    await sendWelcome(ctx, msg.chat.id, L, menuKb);
    return { start: true };
  }
  if (cmd === '/help') { await send(ctx, msg.chat.id, text(L, 'help'), { reply_markup: playKb }); return { help: true }; }
  if (cmd === '/ref' || cmd === '/invite') { await sendRef(ctx, msg.chat.id, fromId, L); return { ref: true }; }
  if (cmd === '/me' || cmd === '/profile') { await sendMe(ctx, msg.chat.id, fromId, L, playKb); return { me: true }; }
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
/nft — NFT-призы: коллекции, цены, склад
/nft_stock &lt;nft_id|all&gt; &lt;кол-во&gt; — сколько штук коллекции разыгрывать (0 — убрать из кейсов)
/nft_sync — NFT в вашем Business-аккаунте
/nft_add &lt;owned_gift_id&gt; — положить свой NFT в кейсы (цена по коллекции)
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
      const rows = await db.prepare("SELECT tier, status, COUNT(*) AS n FROM nft_stock WHERE status != 'removed' GROUP BY tier, status").all<{ tier: string; status: string; n: number }>();
      const cnt = (id: string, st: string) => (rows.results ?? []).find((r) => r.tier === id && r.status === st)?.n ?? 0;
      const where = (id: string) => Object.entries(NFT_DROPS).filter(([, d]) => id in d).map(([c]) => c).join(', ');
      const list = NFT_COLLECTIONS.map((n) => `${cnt(n.id, 'in_stock') ? '🟢' : '⚪️'} <b>${esc(n.title)}</b> · ${n.value}⭐ · склад ${cnt(n.id, 'in_stock')}${cnt(n.id, 'reserved') ? ` · выпало ${cnt(n.id, 'reserved')}` : ''}${cnt(n.id, 'delivered') ? ` · выдано ${cnt(n.id, 'delivered')}` : ''}\n   <code>${n.id}</code> → ${where(n.id)}`);
      await send(ctx, chatId, `💎 <b>NFT-призы</b> (выдача: ${ctx.cfg.nftDelivery === 'manual' ? 'вручную' : 'авто'})\n\n${list.join('\n')}\n\nИзменить склад: /nft_stock nft_witchhat 2`);
      return { nft: list.length };
    }
    case '/nft_stock': {
      const [which, nRaw] = args;
      const n = Math.max(0, Math.min(20, Math.floor(Number(nRaw))));
      const targets = which === 'all' ? NFT_COLLECTIONS : NFT_COLLECTIONS.filter((c) => c.id === which);
      if (!targets.length || !Number.isFinite(n) || nRaw == null) { await send(ctx, chatId, 'Формат: /nft_stock &lt;nft_id|all&gt; &lt;0–20&gt;. Список id: /nft'); return { nftStock: 'bad' }; }
      const out: string[] = [];
      for (const col of targets) out.push(`${esc(col.title)}: ${await setManualStock(ctx, col.id, n)}`);
      log('info', 'nft_stock_set', { which, n });
      await send(ctx, chatId, `✅ Склад обновлён\n${out.join('\n')}`);
      return { nftStock: 'ok' };
    }
    case '/nft_sync': {
      const conn = await ownerConnection(ctx);
      if (!conn) { await send(ctx, chatId, BUSINESS_HOWTO); return { nftSync: 'no_connection' }; }
      const gifts = await listUniqueGifts(ctx, conn.id);
      const stocked = new Set(((await db.prepare("SELECT owned_gift_id FROM nft_stock WHERE status != 'removed'").all<{ owned_gift_id: string }>()).results ?? []).map((r) => r.owned_gift_id));
      const lines = gifts.map((g) => {
        const col = nftCollectionByName(g.name);
        return `${stocked.has(g.owned_gift_id) ? '✅' : col ? '➕' : '·'} <a href="https://t.me/nft/${esc(g.name)}">${esc(g.title)}</a> · перевод ${g.transfer_star_count ?? 0}⭐${g.can_be_transferred === false ? ' · нельзя передать' : ''}${col ? `\n<code>/nft_add ${g.owned_gift_id}</code> (${col.value}⭐)` : ' · коллекции нет в кейсах'}`;
      });
      await send(ctx, chatId, lines.length ? `💎 NFT в Business-аккаунте\n\n${lines.join('\n\n')}` : 'В Business-аккаунте нет передаваемых NFT.');
      return { nftSync: gifts.length };
    }
    case '/nft_add': {
      const [ownedId] = args;
      if (!ownedId) { await send(ctx, chatId, 'Формат: /nft_add &lt;owned_gift_id&gt; (список: /nft_sync)'); return { nftAdd: 'bad' }; }
      const conn = await ownerConnection(ctx);
      if (!conn) { await send(ctx, chatId, BUSINESS_HOWTO); return { nftAdd: 'no_connection' }; }
      const g = (await listUniqueGifts(ctx, conn.id)).find((x) => x.owned_gift_id === ownedId);
      if (!g) { await send(ctx, chatId, 'NFT с таким owned_gift_id не найден в Business-аккаунте (/nft_sync).'); return { nftAdd: 'missing' }; }
      if (g.can_be_transferred === false) { await send(ctx, chatId, 'Этот NFT нельзя передать.'); return { nftAdd: 'locked' }; }
      const col = nftCollectionByName(g.name);
      if (!col) { await send(ctx, chatId, `Коллекции ${esc(g.title)} нет среди призов (/nft). Её цену и место в кейсах сначала нужно добавить в каталог.`); return { nftAdd: 'unknown_collection' }; }
      const value = col.value;
      const tier = col.id;
      await db.prepare(`INSERT INTO nft_stock (owned_gift_id, name, title, value, tier, transfer_cost, status, added_at) VALUES (?, ?, ?, ?, ?, ?, 'in_stock', ?)
        ON CONFLICT(owned_gift_id) DO UPDATE SET value = excluded.value, tier = excluded.tier, transfer_cost = excluded.transfer_cost, status = CASE WHEN nft_stock.status = 'removed' THEN 'in_stock' ELSE nft_stock.status END`)
        .bind(ownedId, g.name, g.title, value, tier, g.transfer_star_count ?? 0, Date.now()).run();
      log('info', 'nft_added', { ownedId, value, tier });
      await send(ctx, chatId, `✅ ${esc(g.title)} добавлен: ${value}⭐ (${esc(col.title)}). Он появится в кейсах: ${Object.entries(NFT_DROPS).filter(([, d]) => col.id in d).map(([c]) => c).join(', ')}.`);
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
      const r = await db.prepare('UPDATE users SET luck_pct = ?, luck_until = ? WHERE id = ? RETURNING id').bind(pct, pct ? 4102444800000 : 0, String(userId)).first();
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
  const data = String(q.data ?? '');
  if (data.startsWith('u:')) {
    const L = q.from?.language_code;
    const chat = q.message?.chat?.id ?? q.from?.id;
    await answer('');
    if (data === 'u:ref') await sendRef(ctx, chat, fromId, L);
    else if (data === 'u:help') await send(ctx, chat, text(L, 'help'), { reply_markup: { inline_keyboard: [[{ text: `👻 ${text(L, 'play')}`, web_app: { url: ctx.cfg.webAppUrl } }]] } });
    return { callback: data };
  }
  if (!(await isAdmin(ctx, fromId))) { await answer('Нет доступа'); return { callback: 'denied' }; }
  const [act, id] = data.split(':');
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

/** /start: create the player on first contact, remember the deep-link referrer, mark the chat as open for notifications. */
async function startUser(ctx: Ctx, userId: string, payload: string) {
  const exists = await ctx.db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
  if (!exists) await getOrCreateUser(ctx.db, userId);
  await ctx.db.prepare('UPDATE users SET bot_started = 1 WHERE id = ?').bind(userId).run();
  const ref = parseRef(payload);
  if (ref) await attachReferral(ctx.db, userId, ref);
}

const BANNER = 'share/banner.jpg';
async function sendWelcome(ctx: Ctx, chatId: number, lang: string | undefined, kb: Any) {
  try {
    await ctx.tg.call('sendPhoto', { chat_id: chatId, photo: ctx.cfg.webAppUrl.replace(/\/?$/, '/') + BANNER, caption: text(lang, 'welcome'), parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await send(ctx, chatId, text(lang, 'welcome'), { reply_markup: kb });
  }
}

async function sendRef(ctx: Ctx, chatId: number, userId: string, lang: string | undefined) {
  await getOrCreateUser(ctx.db, userId);
  const [u, f] = await Promise.all([
    ctx.db.prepare('SELECT ref_earned FROM users WHERE id = ?').bind(userId).first<{ ref_earned: number }>(),
    ctx.db.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?').bind(userId).first<{ n: number }>(),
  ]);
  const link = refLink(userId);
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text(lang, 'invite_text'))}`;
  await send(ctx, chatId, text(lang, 'ref_info', { link, f: f?.n ?? 0, e: u?.ref_earned ?? 0 }), { reply_markup: { inline_keyboard: [[{ text: text(lang, 'btn_share'), url: share }]] } });
}

async function sendMe(ctx: Ctx, chatId: number, userId: string, lang: string | undefined, kb: Any) {
  const u = await getOrCreateUser(ctx.db, userId) as Any;
  const lv = levelInfo(u.xp ?? 0);
  await send(ctx, chatId, text(lang, 'me', { name: esc(u.tg_first_name || 'Ghost'), b: u.balance, lvl: lv.level, xp: u.xp ?? 0, s: u.streak_count ?? 0, o: u.stats_opens }), { reply_markup: kb });
}

/** Opt-in evening reminder (18:00–21:59 Kyiv) for players whose streak would break tonight. Max 1/day per player. */
export async function streakReminders(ctx: Ctx, now = Date.now(), limit = 25) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hourCycle: 'h23' }).format(now));
  if (hour < 18 || hour > 21) return 0;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now - 86400_000);
  const rows = (await ctx.db.prepare(`SELECT id, lang, streak_count FROM users WHERE notify = 1 AND bot_started = 1 AND streak_day = ? AND streak_count >= 2
    AND (notified_day IS NULL OR notified_day != ?) LIMIT ?`).bind(yesterday, today, limit).all<{ id: string; lang: string | null; streak_count: number }>()).results ?? [];
  let sent = 0;
  for (const r of rows) {
    await ctx.db.prepare('UPDATE users SET notified_day = ? WHERE id = ?').bind(today, r.id).run();
    try {
      await ctx.tg.call('sendMessage', { chat_id: Number(r.id), text: text(r.lang, 'streak_reminder', { n: r.streak_count }), parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: `🔥 ${text(r.lang, 'play')}`, web_app: { url: ctx.cfg.webAppUrl + '?push=quests' } }]] } });
      sent++;
    } catch (e) {
      if (/403|blocked|deactivated|chat not found/i.test(String(e))) await ctx.db.prepare('UPDATE users SET notify = 0, bot_started = 0 WHERE id = ?').bind(r.id).run();
    }
  }
  if (sent) log('info', 'streak_reminders', { sent });
  return sent;
}

/** Manual stock = N "one gift of this collection" units (owned_gift_id manual:<prize>:<k>). Never touches won/delivered units. */
export async function setManualStock(ctx: Ctx, prizeId: string, n: number) {
  const col = nftCollection(prizeId);
  if (!col) return 'нет такой коллекции';
  const db = ctx.db;
  const now = Date.now();
  const have = (await db.prepare("SELECT id, owned_gift_id, status FROM nft_stock WHERE tier = ? AND owned_gift_id LIKE 'manual:%'").bind(prizeId).all<{ id: number; owned_gift_id: string; status: string }>()).results ?? [];
  const inStock = have.filter((r) => r.status === 'in_stock');
  const stmts: D1PreparedStatement[] = [];
  if (inStock.length > n) {
    for (const r of inStock.slice(n)) stmts.push(db.prepare("UPDATE nft_stock SET status = 'removed' WHERE id = ? AND status = 'in_stock'").bind(r.id));
  } else {
    let need = n - inStock.length;
    for (const r of have.filter((x) => x.status === 'removed')) {
      if (!need) break;
      stmts.push(db.prepare("UPDATE nft_stock SET status = 'in_stock', value = ?, title = ? WHERE id = ? AND status = 'removed'").bind(col.value, col.title, r.id));
      need--;
    }
    let k = have.length;
    while (need-- > 0) {
      k++;
      stmts.push(db.prepare(`INSERT OR IGNORE INTO nft_stock (owned_gift_id, name, title, value, tier, transfer_cost, status, added_at) VALUES (?, '', ?, ?, ?, 0, 'in_stock', ?)`)
        .bind(`manual:${prizeId}:${now.toString(36)}${k}`, col.title, col.value, prizeId, now));
    }
  }
  stmts.push(db.prepare("UPDATE nft_stock SET value = ? WHERE tier = ? AND status = 'in_stock'").bind(col.value, prizeId));
  await db.batch(stmts);
  const left = await db.prepare("SELECT COUNT(*) AS n FROM nft_stock WHERE tier = ? AND status = 'in_stock'").bind(prizeId).first<{ n: number }>();
  return `в кейсах ${left?.n ?? 0} шт.`;
}
