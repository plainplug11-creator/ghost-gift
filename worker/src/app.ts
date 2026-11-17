import { AuthError, verifyInitData, type TelegramUser } from './auth.ts';
import { handleUpdate } from './bot.ts';
import type { Config } from './config.ts';
import { CASES, NFT_DROPS, PRIZES, PREMIUM_TIERS, bankFilter, caseById, isBigPrize, liveDrops, type CaseDrop, type Prize } from './catalog.ts';
import { randomHex } from './crypto.ts';
import { ownerConnection, type Ctx } from './ctx.ts';
import { Tx, isConflict, todayKyiv } from './db.ts';
import { PREMIUM_STARS, enqueueDelivery, processDelivery } from './delivery.ts';
import { fairRoll, newSeed, seedHash, verifyFair } from './fair.ts';
import { log } from './log.ts';
import { createTopup, invoiceStatus } from './payments.ts';
import { hitRateLimit, inspectSpinTiming, recordFingerprint } from './risk.ts';
import { Tg, type TgApi } from './telegram.ts';
import { ApiError, getOrCreateUser, ledger, mustUser, type UserRow } from './users.ts';
import { notifyAdminReview } from './withdrawals.ts';

export { ApiError };

export interface AppReq {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  ip: string;
}
export interface AppRes { status: number; headers?: Record<string, string>; body: unknown }
export interface Deps { tg?: TgApi; waitUntil?: (p: Promise<unknown>) => void }

const DAY = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const id = (n = 16) => randomHex(n);
const header = (h: Record<string, string>, k: string) => {
  const want = k.toLowerCase();
  for (const [x, v] of Object.entries(h)) if (x.toLowerCase() === want) return v;
  return '';
};
type Mutation = (tx: Tx, firstAttempt: boolean) => Promise<unknown>;

const bankReady = new WeakMap<D1Database, Promise<unknown>>();

export function createApp(db: D1Database, cfg: Config, deps: Deps = {}) {
  const ctx: Ctx = {
    db, cfg,
    tg: deps.tg ?? new Tg(cfg.botToken),
    waitUntil: deps.waitUntil ?? ((p) => { void p; }),
  };
  const bg = (p: Promise<unknown>) => ctx.waitUntil(p.catch((e) => log('error', 'background_error', { err: e instanceof Error ? e.message : String(e) })));

  async function handle(req: AppReq): Promise<AppRes> {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method.toUpperCase();
    const cors = corsHeaders(cfg, header(req.headers, 'origin'));
    const ok = (body: unknown): AppRes => ({ status: 200, headers: cors, body });
    if (method === 'OPTIONS') return { status: 204, headers: cors, body: '' };
    try {
      if (method === 'GET' && path === '/health') return ok({ ok: true });
      if (method === 'POST' && path === '/v1/fairness/verify') return ok(await verifyFair(json(req) as never));
      await ensureBank();
      if (method === 'GET' && path === '/v1/cases') return ok({ cases: await liveCases() });
      if (method === 'POST' && (path === '/v1/webhook/telegram' || path === '/v1/telegram/payment')) {
        if (cfg.webhookSecret && header(req.headers, 'x-telegram-bot-api-secret-token') !== cfg.webhookSecret) throw new ApiError(401, 'UNAUTHORIZED');
        return ok(await handleUpdate(ctx, json(req)));
      }
      const tgUser = await authorize(req);
      const userId = String(tgUser.id);
      const deviceId = header(req.headers, 'x-device-id');
      await recordFingerprint(db, cfg, userId, deviceId, req.ip);
      if (await hitRateLimit(db, `api:${userId}`, cfg.rateLimitPerMin)) throw new ApiError(429, 'BUSY', 'rate_limited');

      if (method === 'POST' && path === '/v1/bootstrap') return ok(await bootstrap(tgUser));
      if (method === 'GET' && path === '/v1/next-round') return ok(await nextRound(userId));
      if (method === 'GET' && path === '/v1/inventory') return ok({ inventory: await inventory(userId) });
      if (method === 'POST' && path === '/v1/open') return ok(await mutate(userId, req, (tx, first) => openCase(tx, first, userId, json(req))));
      if (method === 'POST' && path === '/v1/sell') return ok(await mutate(userId, req, (tx) => sell(tx, userId, json(req).uid)));
      if (method === 'POST' && path === '/v1/withdraw') return ok(await withdrawFlow(userId, req));
      if (method === 'POST' && path === '/v1/buy-premium') return ok(await premiumFlow(userId, req));
      if (method === 'POST' && path === '/v1/topup') return ok(await createTopup(ctx, userId, Number(json(req).stars)));
      if (method === 'GET' && path === '/v1/invoice') return ok(await invoiceStatus(ctx, userId, url.searchParams.get('id') || ''));
      return { status: 404, headers: cors, body: { error: 'NOT_FOUND' } };
    } catch (e) {
      if (e instanceof AuthError) return { status: 401, headers: cors, body: { error: e.code } };
      if (e instanceof ApiError) return { status: e.status, headers: cors, body: { error: e.code } };
      log('error', 'server_error', { path, err: e instanceof Error ? e.message : 'unknown' });
      return { status: 500, headers: cors, body: { error: 'BUSY' } };
    }
  }

  function ensureBank() {
    let p = bankReady.get(db);
    if (!p) {
      p = db.prepare('INSERT OR IGNORE INTO bank (id, balance, big_prizes_today, day) VALUES (1, ?, 0, ?)').bind(cfg.bankStart, todayKyiv()).run();
      p.catch(() => bankReady.delete(db));
      bankReady.set(db, p);
    }
    return p;
  }

  async function authorize(req: AppReq): Promise<TelegramUser & { language_code?: string }> {
    const auth = header(req.headers, 'authorization');
    const raw = auth.toLowerCase().startsWith('tma ') ? auth.slice(4) : header(req.headers, 'x-init-data') || '';
    const { user } = await verifyInitData(raw, cfg.botToken, cfg.authMaxAgeSec);
    return user;
  }

  async function nftTiersInStock(): Promise<string[]> {
    const r = await db.prepare("SELECT DISTINCT tier FROM nft_stock WHERE status = 'in_stock'").all<{ tier: string }>();
    return (r.results ?? []).map((x) => x.tier);
  }

  async function liveCases() {
    const stock = await nftTiersInStock();
    return CASES.map((c) => ({ ...c, drops: liveDrops(c, { nftInStock: stock }) }));
  }

  /** Idempotent, atomic mutation with optimistic-concurrency retries. */
  async function mutate(userId: string, req: AppReq, fn: Mutation): Promise<unknown> {
    const key = header(req.headers, 'x-idempotency-key') || (json(req).idempotencyKey as string | undefined);
    for (let attempt = 0; ; attempt++) {
      if (key) {
        const hit = await db.prepare('SELECT response FROM idempotency WHERE user_id = ? AND key = ?').bind(userId, key).first<{ response: string }>();
        if (hit) return JSON.parse(hit.response);
      }
      const tx = new Tx(db);
      const out = await fn(tx, attempt === 0);
      if (key) tx.add('INSERT INTO idempotency (key, user_id, response, created_at) VALUES (?, ?, ?, ?)', key, userId, JSON.stringify(out), Date.now());
      try {
        await tx.commit();
        return out;
      } catch (e) {
        if (isConflict(e) && attempt + 1 < MAX_ATTEMPTS) continue;
        if (isConflict(e)) throw new ApiError(429, 'BUSY', 'conflict');
        throw e;
      }
    }
  }

  async function bootstrap(tgUser: TelegramUser & { language_code?: string }) {
    const userId = String(tgUser.id);
    const u = await getOrCreateUser(db, userId);
    await db.prepare('UPDATE users SET tg_username = ?, tg_first_name = ?, lang = COALESCE(?, lang), last_seen = ? WHERE id = ?')
      .bind(tgUser.username ?? null, tgUser.first_name ?? null, tgUser.language_code ?? null, Date.now(), userId).run();
    return {
      balance: u.balance,
      inventory: await inventory(userId),
      dailyReadyAt: u.daily_ready_at,
      fairness: { serverSeedHash: await seedHash(u.server_seed), clientSeed: u.client_seed, nonce: u.nonce + 1 },
      riskScore: u.risk_score,
      luckPct: u.luck_pct ?? 0,
    };
  }

  async function nextRound(userId: string) {
    const u = await getOrCreateUser(db, userId);
    return { serverSeedHash: await seedHash(u.server_seed), clientSeed: u.client_seed, nonce: u.nonce + 1 };
  }

  async function inventory(userId: string) {
    const r = await db.prepare(`SELECT i.uid, i.prize_id AS prizeId, i.case_id AS caseId, i.won_at AS wonAt, i.status, i.value, n.title, n.name
      FROM inventory i LEFT JOIN nft_stock n ON n.id = i.nft_id
      WHERE i.user_id = ? AND i.status IN ('owned', 'withdrawing') ORDER BY i.won_at DESC`)
      .bind(userId).all<{ uid: string; prizeId: string; caseId: string; wonAt: number; status: string; value: number | null; title: string | null; name: string | null }>();
    return (r.results ?? []).map(({ value, title, name, ...it }) => ({
      ...it,
      ...(value != null ? { value } : {}),
      ...(title ? { nft: { title, name: name ?? '', link: `https://t.me/nft/${name ?? ''}` } } : {}),
    }));
  }

  function pickFrom(drops: CaseDrop[], r: number): Prize {
    const total = drops.reduce((s, d) => s + d.weight, 0);
    let x = r * total;
    for (const d of drops) { x -= d.weight; if (x < 0) return PRIZES[d.prize]; }
    return PRIZES[drops[drops.length - 1].prize];
  }

  async function openCase(tx: Tx, firstAttempt: boolean, userId: string, body: { caseId?: string; demo?: boolean }) {
    const c = caseById(body.caseId || '');
    if (!c) throw new ApiError(404, 'NOT_FOUND');
    const demo = !!body.demo;
    const u = await getOrCreateUser(db, userId);
    if (!demo) {
      if (c.price === 0) {
        if (u.daily_ready_at > Date.now()) throw new ApiError(403, 'DAILY_COOLDOWN');
      } else if (u.balance < c.price) throw new ApiError(400, 'NO_BALANCE');
      if (firstAttempt && (await hitRateLimit(db, `open:${userId}`, cfg.openLimitPerMin))) throw new ApiError(429, 'BUSY', 'rate_limited');
      if (u.risk_score >= 80 && u.flagged) throw new ApiError(429, 'BUSY', 'risk_blocked');
      if (firstAttempt) await inspectSpinTiming(db, cfg, userId);
    }

    const [stock, bank] = await Promise.all([nftTiersInStock(), bankState()]);
    const full = liveDrops(c, { nftInStock: stock, luckPct: demo ? 0 : u.luck_pct });

    if (demo) {
      const seed = newSeed();
      const fairness = { serverSeedHash: await seedHash(seed), clientSeed: u.client_seed, nonce: 0, serverSeed: seed };
      const prize = pickFrom(full, await fairRoll(seed, u.client_seed, 0));
      return { roundId: id(8), caseId: c.id, demo: true, prize: { ...prize }, balance: u.balance, fairness };
    }

    const serverSeed = u.server_seed;
    const nonce = u.nonce + 1;
    const clientSeed = u.client_seed;
    const [hash, roll] = await Promise.all([seedHash(serverSeed), fairRoll(serverSeed, clientSeed, nonce)]);
    let drops = bankFilter(c, full, bank, { reserve: cfg.bankReserve, dailyBigCap: cfg.dailyBigPrizeCap, bigMin: cfg.bigPrizeMinValue });
    let prize = pickFrom(drops, roll);
    let nft: { id: number; title: string; name: string; value: number } | null = null;
    if (prize.kind === 'nft') {
      const nominal = prize.value;
      nft = await db.prepare("SELECT id, title, name, value FROM nft_stock WHERE tier = ? AND status = 'in_stock' ORDER BY ABS(value - ?) LIMIT 1")
        .bind(prize.id, nominal).first<{ id: number; title: string; name: string; value: number }>();
      if (!nft) { // sold out between table build and pick → same roll on the table without NFT tiers
        drops = drops.filter((d) => PRIZES[d.prize].kind !== 'nft');
        prize = pickFrom(drops.length ? drops : full.filter((d) => PRIZES[d.prize].kind !== 'nft'), roll);
      }
    }
    const value = nft ? nft.value : prize.value;
    const shown: Prize = nft ? { ...prize, value, nft: { title: nft.title, name: nft.name, link: `https://t.me/nft/${nft.name}` } } : { ...prize };
    const nextSeed = newSeed();
    const now = Date.now();
    const roundId = id(8);

    tx.guardUser(userId, u.version);
    let balance = u.balance - c.price;
    let credited: number | undefined;
    let itemUid: string | undefined;
    if (c.price === 0) tx.add('UPDATE users SET daily_ready_at = ? WHERE id = ?', now + DAY, userId);
    if (c.price) ledger(tx, userId, 'case_open', -c.price, balance, roundId);
    const best = c.price ? Math.max(u.stats_best, +(value / c.price).toFixed(1)) : u.stats_best;
    const wins = u.stats_wins + (value >= c.price ? 1 : 0);
    if (prize.kind === 'stars') {
      balance += value;
      credited = value;
      ledger(tx, userId, 'prize_stars', value, balance, roundId);
    } else {
      itemUid = id(6);
      if (nft) {
        tx.add("INSERT INTO tx_guard (n) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM nft_stock WHERE id = ? AND status = 'in_stock')", nft.id);
        tx.add("UPDATE nft_stock SET status = 'reserved', item_uid = ? WHERE id = ?", itemUid, nft.id);
      }
      tx.add('INSERT INTO inventory (uid, user_id, prize_id, case_id, won_at, status, nft_id, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        itemUid, userId, prize.id, c.id, now, 'owned', nft?.id ?? null, nft ? value : null);
    }
    tx.add('UPDATE users SET balance = ?, server_seed = ?, nonce = ?, stats_opens = stats_opens + 1, stats_wins = ?, stats_best = ? WHERE id = ?',
      balance, nextSeed, nonce, wins, best, userId);
    tx.add(`INSERT INTO fairness_log (round_id, user_id, case_id, server_seed, server_seed_hash, client_seed, nonce, roll, prize_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, roundId, userId, c.id, serverSeed, hash, clientSeed, nonce, roll, prize.id, now);
    applyBank(tx, c.price, value);
    if (isBigPrize(value, c.price, cfg.bigPrizeMinValue)) log('info', 'big_prize', { user: userId, case: c.id, prize: prize.id, value });

    return {
      roundId, caseId: c.id, demo: false, prize: shown, itemUid, credited, balance,
      dailyReadyAt: c.price === 0 ? now + DAY : u.daily_ready_at,
      fairness: { serverSeedHash: hash, clientSeed, nonce, serverSeed },
    };
  }

  async function ownedItem(userId: string, uid: string) {
    if (!uid) throw new ApiError(404, 'NOT_FOUND');
    const it = await db.prepare('SELECT uid, prize_id AS prizeId, status, nft_id AS nftId, value FROM inventory WHERE uid = ? AND user_id = ?').bind(uid, userId)
      .first<{ uid: string; prizeId: string; status: string; nftId: number | null; value: number | null }>();
    if (!it || it.status !== 'owned') throw new ApiError(404, 'NOT_FOUND');
    return it;
  }

  async function sell(tx: Tx, userId: string, uid: string) {
    const it = await ownedItem(userId, uid);
    const value = it.value ?? PRIZES[it.prizeId]?.value;
    if (value == null) throw new ApiError(404, 'NOT_FOUND');
    const u = await mustUser(db, userId);
    const balance = u.balance + value;
    tx.guardUser(userId, u.version);
    tx.add("INSERT INTO tx_guard (n) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM inventory WHERE uid = ? AND status = 'owned')", uid);
    tx.add("UPDATE inventory SET status = 'sold' WHERE uid = ?", uid);
    if (it.nftId) tx.add("UPDATE nft_stock SET status = 'in_stock', item_uid = NULL WHERE id = ? AND status = 'reserved'", it.nftId);
    tx.add('UPDATE users SET balance = ? WHERE id = ?', balance, userId);
    ledger(tx, userId, 'sell', value, balance, uid);
    return { balance, credited: value };
  }

  function reviewReasons(u: UserRow, value: number, kind: string) {
    const reasons: string[] = [];
    if (kind === 'nft') reasons.push('nft');
    else if (value > cfg.withdrawReviewMin) reasons.push('large');
    if ((Date.now() - u.created_at) / 3600000 < cfg.newAccountHours) reasons.push('new_account');
    if (u.risk_score >= cfg.reviewRiskScore || u.flagged) reasons.push('high_risk');
    return reasons;
  }

  async function withdrawFlow(userId: string, req: AppReq) {
    const out = await mutate(userId, req, (tx) => withdraw(tx, userId, json(req).uid)) as { status: 'queued'; review: boolean; withdrawalId?: string; deliveryId?: string; fresh?: boolean };
    afterWithdrawal(out);
    return { status: out.status, review: out.review };
  }

  function afterWithdrawal(out: { review: boolean; withdrawalId?: string; deliveryId?: string; fresh?: boolean }) {
    if (!out.fresh) return; // idempotent replay
    if (out.deliveryId) bg(processDelivery(ctx, out.deliveryId));
    else if (out.review && out.withdrawalId) bg(notifyAdminReview(ctx, out.withdrawalId));
  }

  async function withdraw(tx: Tx, userId: string, uid: string) {
    const it = await ownedItem(userId, uid);
    const prize = PRIZES[it.prizeId];
    if (!prize || prize.kind === 'stars') throw new ApiError(404, 'NOT_FOUND');
    const kind = prize.kind === 'premium' ? 'premium' : prize.kind === 'nft' ? 'nft' : 'gift';
    if (kind === 'nft' && !(await ownerConnection(ctx))) throw new ApiError(409, 'NFT_PENDING');
    const value = it.value ?? prize.value;
    const u = await mustUser(db, userId);
    const reasons = reviewReasons(u, value, kind);
    const status = reasons.length ? 'review' : 'approved';
    const wid = id(8);
    tx.guardUser(userId, u.version);
    tx.add("INSERT INTO tx_guard (n) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM inventory WHERE uid = ? AND status = 'owned')", uid);
    tx.add("UPDATE inventory SET status = 'withdrawing' WHERE uid = ?", uid);
    tx.add('INSERT INTO withdrawals (id, user_id, item_uid, prize_id, value, status, reason, created_at, kind, months, nft_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      wid, userId, uid, prize.id, value, status, reasons.join(',') || null, Date.now(), kind, prize.months ?? null, it.nftId);
    const deliveryId = status === 'approved'
      ? enqueueDelivery(tx, { withdrawalId: wid, userId, kind, prizeId: prize.id, months: prize.months ?? null, nftId: it.nftId, cost: kind === 'premium' ? PREMIUM_STARS[prize.months ?? 3] : value })
      : undefined;
    log('info', 'withdraw', { user: userId, prize: prize.id, status, reasons: reasons.join(',') });
    return { status: 'queued' as const, review: status === 'review', withdrawalId: wid, deliveryId, fresh: true };
  }

  async function premiumFlow(userId: string, req: AppReq) {
    const body = json(req);
    const out = await mutate(userId, req, (tx) => buyPremium(tx, userId, body.months)) as { status: 'queued'; balance: number; review: boolean; withdrawalId?: string; deliveryId?: string; fresh?: boolean };
    afterWithdrawal(out);
    return { status: out.status, balance: out.balance, review: out.review };
  }

  async function buyPremium(tx: Tx, userId: string, months: number) {
    const tier = PREMIUM_TIERS.find((x) => x.months === months);
    if (!tier) throw new ApiError(404, 'NOT_FOUND');
    const u = await mustUser(db, userId);
    if (u.balance < tier.price) throw new ApiError(400, 'NO_BALANCE');
    const balance = u.balance - tier.price;
    const reasons = reviewReasons(u, 0, 'premium'); // paid from balance: only account age / risk matter
    const status = reasons.length ? 'review' : 'approved';
    const wid = id(8);
    const prizeId = `prem${months}`;
    tx.guardUser(userId, u.version);
    tx.add('UPDATE users SET balance = ? WHERE id = ?', balance, userId);
    ledger(tx, userId, 'premium_buy', -tier.price, balance, `prem${months}:${wid}`);
    tx.add('INSERT INTO withdrawals (id, user_id, item_uid, prize_id, value, status, reason, created_at, kind, months, paid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      wid, userId, `prem:${wid}`, prizeId, tier.base, status, reasons.join(',') || null, Date.now(), 'premium', months, tier.price);
    const deliveryId = status === 'approved'
      ? enqueueDelivery(tx, { withdrawalId: wid, userId, kind: 'premium', prizeId, months, cost: tier.base })
      : undefined;
    return { status: 'queued' as const, balance, review: status === 'review', withdrawalId: wid, deliveryId, fresh: true };
  }

  async function bankState() {
    const day = todayKyiv();
    const row = await db.prepare('SELECT balance, big_prizes_today AS big, day FROM bank WHERE id = 1').first<{ balance: number; big: number; day: string }>();
    if (!row) return { balance: cfg.bankStart, bigToday: 0 };
    return { balance: row.balance, bigToday: row.day !== day ? 0 : row.big };
  }

  function applyBank(tx: Tx, paid: number, prizeValue: number) {
    const day = todayKyiv();
    const inc = isBigPrize(prizeValue, paid, cfg.bigPrizeMinValue) ? 1 : 0;
    tx.add('UPDATE bank SET balance = balance + ? - ?, big_prizes_today = CASE WHEN day = ? THEN big_prizes_today + ? ELSE ? END, day = ? WHERE id = 1',
      paid, prizeValue, day, inc, inc, day);
  }

  return { handle, db, ctx };
}

const ALLOW_HEADERS = 'Authorization, Content-Type, X-Device-Id, X-Idempotency-Key, X-Init-Data, X-Telegram-Bot-Api-Secret-Token';
export function corsHeaders(cfg: Config, origin: string): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (cfg.allowedOrigins.includes('*')) h['Access-Control-Allow-Origin'] = '*';
  else if (origin && cfg.allowedOrigins.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(req: AppReq): Record<string, any> {
  if (!req.body) return {};
  try { return JSON.parse(req.body); } catch { throw new ApiError(400, 'NOT_FOUND', 'bad_json'); }
}
void NFT_DROPS;
