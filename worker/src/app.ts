import { AuthError, verifyInitData } from './auth.ts';
import type { Config } from './config.ts';
import { CASES, PRIZES, PREMIUM_TIERS, caseById, type Prize } from './catalog.ts';
import { randomHex } from './crypto.ts';
import { Tx, isConflict, todayKyiv } from './db.ts';
import { fairRoll, newSeed, seedHash, verifyFair } from './fair.ts';
import { bumpRiskStmt, hitRateLimit, inspectSpinTiming, recordFingerprint } from './risk.ts';

export class ApiError extends Error {
  constructor(public status: number, public code: string, msg = code) { super(msg); }
}

export interface AppReq {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  ip: string;
}
export interface AppRes { status: number; headers?: Record<string, string>; body: unknown }

const DAY = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RARITY_RANK: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
const id = (n = 16) => randomHex(n);
const header = (h: Record<string, string>, k: string) => {
  const want = k.toLowerCase();
  for (const [x, v] of Object.entries(h)) if (x.toLowerCase() === want) return v;
  return '';
};

interface UserRow {
  id: string; balance: number; client_seed: string; server_seed: string; nonce: number;
  created_at: number; daily_ready_at: number; risk_score: number; flagged: number;
  stats_opens: number; stats_wins: number; stats_best: number; version: number;
}
/** A mutation: reads freely, queues writes on tx, returns the response body. */
type Mutation = (tx: Tx, firstAttempt: boolean) => Promise<unknown>;

const bankReady = new WeakMap<D1Database, Promise<unknown>>();

export function createApp(db: D1Database, cfg: Config) {
  async function handle(req: AppReq): Promise<AppRes> {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method.toUpperCase();
    const cors = corsHeaders(cfg, header(req.headers, 'origin'));
    const ok = (body: unknown): AppRes => ({ status: 200, headers: cors, body });
    if (method === 'OPTIONS') return { status: 204, headers: cors, body: '' };
    try {
      if (method === 'GET' && path === '/health') return ok({ ok: true });
      if (method === 'GET' && path === '/v1/cases') return ok({ cases: CASES });
      if (method === 'POST' && path === '/v1/fairness/verify') return ok(await verifyFair(json(req) as never));
      await ensureBank();
      if (method === 'POST' && (path === '/v1/webhook/telegram' || path === '/v1/telegram/payment')) {
        return ok(await handleWebhook(req));
      }
      const userId = await authorize(req);
      const deviceId = header(req.headers, 'x-device-id');
      await recordFingerprint(db, cfg, userId, deviceId, req.ip);
      if (await hitRateLimit(db, `api:${userId}`, cfg.rateLimitPerMin)) throw new ApiError(429, 'BUSY', 'rate_limited');

      if (method === 'POST' && path === '/v1/bootstrap') return ok(await bootstrap(userId));
      if (method === 'GET' && path === '/v1/next-round') return ok(await nextRound(userId));
      if (method === 'GET' && path === '/v1/inventory') return ok({ inventory: await inventory(userId) });
      if (method === 'POST' && path === '/v1/open') return ok(await mutate(userId, req, (tx, first) => openCase(tx, first, userId, json(req))));
      if (method === 'POST' && path === '/v1/sell') return ok(await mutate(userId, req, (tx) => sell(tx, userId, json(req).uid)));
      if (method === 'POST' && path === '/v1/withdraw') return ok(await mutate(userId, req, (tx) => withdraw(tx, userId, json(req).uid)));
      if (method === 'POST' && path === '/v1/buy-premium') return ok(await mutate(userId, req, (tx) => buyPremium(tx, userId, json(req).months)));
      return { status: 404, headers: cors, body: { error: 'NOT_FOUND' } };
    } catch (e) {
      if (e instanceof AuthError) return { status: 401, headers: cors, body: { error: e.code } };
      if (e instanceof ApiError) return { status: e.status, headers: cors, body: { error: e.code } };
      console.error('server error', e instanceof Error ? e.message : 'unknown');
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

  async function authorize(req: AppReq): Promise<string> {
    const auth = header(req.headers, 'authorization');
    const raw = auth.toLowerCase().startsWith('tma ') ? auth.slice(4) : header(req.headers, 'x-init-data') || '';
    const { user } = await verifyInitData(raw, cfg.botToken, cfg.authMaxAgeSec);
    return String(user.id);
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

  async function bootstrap(userId: string) {
    const u = await getOrCreateUser(userId);
    return {
      balance: u.balance,
      inventory: await inventory(userId),
      dailyReadyAt: u.daily_ready_at,
      fairness: { serverSeedHash: await seedHash(u.server_seed), clientSeed: u.client_seed, nonce: u.nonce + 1 },
      riskScore: u.risk_score,
    };
  }

  async function nextRound(userId: string) {
    const u = await getOrCreateUser(userId);
    return { serverSeedHash: await seedHash(u.server_seed), clientSeed: u.client_seed, nonce: u.nonce + 1 };
  }

  async function inventory(userId: string) {
    const r = await db.prepare('SELECT uid, prize_id AS prizeId, case_id AS caseId, won_at AS wonAt, status FROM inventory WHERE user_id = ? AND status != ? ORDER BY won_at DESC')
      .bind(userId, 'sold').all<{ uid: string; prizeId: string; caseId: string; wonAt: number; status: string }>();
    return r.results || [];
  }

  async function openCase(tx: Tx, firstAttempt: boolean, userId: string, body: { caseId?: string; demo?: boolean }) {
    const c = caseById(body.caseId || '');
    if (!c) throw new ApiError(404, 'NOT_FOUND');
    const demo = !!body.demo;
    const u = await getOrCreateUser(userId);
    if (!demo) {
      if (c.price === 0) {
        if (u.daily_ready_at > Date.now()) throw new ApiError(403, 'DAILY_COOLDOWN');
      } else if (u.balance < c.price) throw new ApiError(400, 'NO_BALANCE');
      if (firstAttempt) {
        if (await hitRateLimit(db, `open:${userId}`, cfg.openLimitPerMin)) throw new ApiError(429, 'BUSY', 'rate_limited');
        if (u.risk_score >= 80 && u.flagged) throw new ApiError(429, 'BUSY', 'risk_blocked');
        await inspectSpinTiming(db, cfg, userId);
      } else if (u.risk_score >= 80 && u.flagged) throw new ApiError(429, 'BUSY', 'risk_blocked');
    }

    if (demo) {
      const seed = newSeed();
      const fairness = { serverSeedHash: await seedHash(seed), clientSeed: u.client_seed, nonce: 0, serverSeed: seed };
      const prize = pickPrize(c.id, await fairRoll(seed, u.client_seed, 0), await bankState());
      return { roundId: id(8), caseId: c.id, demo: true, prize, balance: u.balance, fairness };
    }

    const serverSeed = u.server_seed;
    const nonce = u.nonce + 1;
    const clientSeed = u.client_seed;
    const [hash, roll, bank] = await Promise.all([seedHash(serverSeed), fairRoll(serverSeed, clientSeed, nonce), bankState()]);
    const prize = pickPrize(c.id, roll, bank);
    const nextSeed = newSeed();
    const now = Date.now();
    const roundId = id(8);

    tx.guardUser(userId, u.version);
    let balance = u.balance - c.price;
    let credited: number | undefined;
    let itemUid: string | undefined;
    if (c.price === 0) tx.add('UPDATE users SET daily_ready_at = ? WHERE id = ?', now + DAY, userId);
    if (c.price) ledger(tx, userId, 'case_open', -c.price, balance, roundId);
    const best = c.price ? Math.max(u.stats_best, +(prize.value / c.price).toFixed(1)) : u.stats_best;
    const wins = u.stats_wins + (prize.value >= c.price ? 1 : 0);
    if (prize.kind === 'stars') {
      balance += prize.value;
      credited = prize.value;
      ledger(tx, userId, 'prize_stars', prize.value, balance, roundId);
    } else {
      itemUid = id(6);
      tx.add('INSERT INTO inventory (uid, user_id, prize_id, case_id, won_at, status) VALUES (?, ?, ?, ?, ?, ?)', itemUid, userId, prize.id, c.id, now, 'owned');
    }
    tx.add('UPDATE users SET balance = ?, server_seed = ?, nonce = ?, stats_opens = stats_opens + 1, stats_wins = ?, stats_best = ? WHERE id = ?',
      balance, nextSeed, nonce, wins, best, userId);
    tx.add(`INSERT INTO fairness_log (round_id, user_id, case_id, server_seed, server_seed_hash, client_seed, nonce, roll, prize_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, roundId, userId, c.id, serverSeed, hash, clientSeed, nonce, roll, prize.id, now);
    applyBank(tx, c.price, prize.value);

    return {
      roundId, caseId: c.id, demo: false, prize, itemUid, credited, balance,
      dailyReadyAt: c.price === 0 ? now + DAY : u.daily_ready_at,
      fairness: { serverSeedHash: hash, clientSeed, nonce, serverSeed },
    };
  }

  async function ownedItem(userId: string, uid: string) {
    if (!uid) throw new ApiError(404, 'NOT_FOUND');
    const it = await db.prepare('SELECT uid, prize_id AS prizeId, status FROM inventory WHERE uid = ? AND user_id = ?').bind(uid, userId)
      .first<{ uid: string; prizeId: string; status: string }>();
    if (!it || it.status !== 'owned') throw new ApiError(404, 'NOT_FOUND');
    return it;
  }

  async function sell(tx: Tx, userId: string, uid: string) {
    const it = await ownedItem(userId, uid);
    const value = PRIZES[it.prizeId]?.value;
    if (value == null) throw new ApiError(404, 'NOT_FOUND');
    const u = await mustUser(userId);
    const balance = u.balance + value;
    tx.guardUser(userId, u.version);
    // status guard: a concurrent sell/withdraw of the same item aborts the batch
    tx.add("INSERT INTO tx_guard (n) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM inventory WHERE uid = ? AND status = 'owned')", uid);
    tx.add("UPDATE inventory SET status = 'sold' WHERE uid = ?", uid);
    tx.add('UPDATE users SET balance = ? WHERE id = ?', balance, userId);
    ledger(tx, userId, 'sell', value, balance, uid);
    return { balance, credited: value };
  }

  async function withdraw(tx: Tx, userId: string, uid: string) {
    const it = await ownedItem(userId, uid);
    const prize = PRIZES[it.prizeId];
    if (!prize) throw new ApiError(404, 'NOT_FOUND');
    const u = await mustUser(userId);
    const ageH = (Date.now() - u.created_at) / 3600000;
    const reasons: string[] = [];
    if (prize.value >= cfg.withdrawReviewMin) reasons.push('large');
    if (ageH < cfg.newAccountHours) reasons.push('new_account');
    if (u.risk_score >= cfg.reviewRiskScore || u.flagged) reasons.push('high_risk');
    const status = reasons.length ? 'review' : 'approved';
    tx.guardUser(userId, u.version);
    tx.add("INSERT INTO tx_guard (n) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM inventory WHERE uid = ? AND status = 'owned')", uid);
    tx.add("UPDATE inventory SET status = 'withdrawing' WHERE uid = ?", uid);
    tx.add('INSERT INTO withdrawals (id, user_id, item_uid, prize_id, value, status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id(8), userId, uid, prize.id, prize.value, status, reasons.join(',') || null, Date.now());
    return { status: 'queued' as const, review: status === 'review' };
  }

  async function buyPremium(tx: Tx, userId: string, months: number) {
    const tier = PREMIUM_TIERS.find((x) => x.months === months);
    if (!tier) throw new ApiError(404, 'NOT_FOUND');
    const u = await mustUser(userId);
    if (u.balance < tier.price) throw new ApiError(400, 'NO_BALANCE');
    const balance = u.balance - tier.price;
    tx.guardUser(userId, u.version);
    tx.add('UPDATE users SET balance = ? WHERE id = ?', balance, userId);
    ledger(tx, userId, 'premium_buy', -tier.price, balance, `prem${months}`);
    return { status: 'queued' as const, balance };
  }

  async function handleWebhook(req: AppReq): Promise<unknown> {
    if (cfg.webhookSecret) {
      const got = header(req.headers, 'x-telegram-bot-api-secret-token');
      if (got !== cfg.webhookSecret) throw new ApiError(401, 'UNAUTHORIZED');
    }
    const update = json(req) as Record<string, unknown>;
    const payment = deep(update, 'message.successful_payment') || update.successful_payment;
    if (payment && typeof payment === 'object') {
      const p = payment as { telegram_payment_charge_id?: string; total_amount?: number; currency?: string; invoice_payload?: string };
      const chargeId = p.telegram_payment_charge_id;
      const stars = Number(p.total_amount) || 0;
      const userId = payloadUser(p.invoice_payload) || String((deep(update, 'message.from.id') as number | undefined) || '');
      if (!chargeId || !userId || stars <= 0) throw new ApiError(400, 'NOT_FOUND', 'bad_payment');
      return withRetry((tx) => creditPayment(tx, userId, chargeId, stars));
    }
    const refund = deep(update, 'message.refunded_payment') || update.refunded_payment;
    if (refund && typeof refund === 'object') {
      const p = refund as { telegram_payment_charge_id?: string; total_amount?: number };
      if (!p.telegram_payment_charge_id) throw new ApiError(400, 'NOT_FOUND', 'bad_refund');
      return withRetry((tx) => applyRefund(tx, p.telegram_payment_charge_id!, Number(p.total_amount) || 0));
    }
    return { ignored: true };
  }

  async function withRetry(fn: (tx: Tx) => Promise<unknown>): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const tx = new Tx(db);
      const out = await fn(tx);
      try {
        await tx.commit();
        return out;
      } catch (e) {
        if (isConflict(e) && attempt + 1 < MAX_ATTEMPTS) continue;
        throw e;
      }
    }
  }

  async function creditPayment(tx: Tx, userId: string, chargeId: string, stars: number) {
    const existing = await db.prepare('SELECT charge_id FROM payments WHERE charge_id = ?').bind(chargeId).first();
    if (existing) return { status: 'duplicate', chargeId };
    const u = await getOrCreateUser(userId);
    const balance = u.balance + stars;
    tx.guardUser(userId, u.version);
    tx.add('INSERT INTO payments (charge_id, user_id, stars, created_at, refunded) VALUES (?, ?, ?, ?, 0)', chargeId, userId, stars, Date.now());
    tx.add('UPDATE users SET balance = ? WHERE id = ?', balance, userId);
    ledger(tx, userId, 'stars_payment', stars, balance, chargeId);
    return { status: 'credited', chargeId, balance };
  }

  async function applyRefund(tx: Tx, chargeId: string, amount: number) {
    const row = await db.prepare('SELECT charge_id, user_id, stars, refunded FROM payments WHERE charge_id = ?').bind(chargeId)
      .first<{ charge_id: string; user_id: string; stars: number; refunded: number }>();
    if (!row) return { status: 'unknown_charge', chargeId };
    if (row.refunded) return { status: 'already_refunded', chargeId };
    const stars = amount || row.stars;
    const u = await mustUser(row.user_id);
    const balance = Math.max(0, u.balance - stars);
    tx.guardUser(row.user_id, u.version);
    tx.add('INSERT INTO tx_guard (n) SELECT 1 WHERE EXISTS (SELECT 1 FROM payments WHERE charge_id = ? AND refunded = 1)', chargeId);
    tx.add('UPDATE payments SET refunded = 1 WHERE charge_id = ?', chargeId);
    tx.add('UPDATE users SET balance = ? WHERE id = ?', balance, row.user_id);
    tx.stmts.push(bumpRiskStmt(db, row.user_id, 30, true));
    ledger(tx, row.user_id, 'refund', -stars, balance, chargeId);
    return { status: 'refunded', chargeId, balance, flagged: true };
  }

  function pickPrize(caseId: string, r: number, bank: { balance: number; bigToday: number }): Prize {
    const c = caseById(caseId)!;
    let drops = c.drops.slice();
    if (bank.balance < cfg.bankReserve) {
      drops = drops.filter((d) => (RARITY_RANK[PRIZES[d.prize].rarity] ?? 0) === 0);
    }
    if (bank.bigToday >= cfg.dailyBigPrizeCap) {
      drops = drops.filter((d) => PRIZES[d.prize].value < cfg.bigPrizeMinValue);
    }
    if (!drops.length) {
      drops = c.drops.filter((d) => PRIZES[d.prize].rarity === 'common');
      if (!drops.length) drops = [c.drops[0]];
    }
    const total = drops.reduce((s, d) => s + d.weight, 0);
    let x = r * total;
    for (const d of drops) { x -= d.weight; if (x < 0) return PRIZES[d.prize]; }
    return PRIZES[drops[drops.length - 1].prize];
  }

  async function bankState() {
    const day = todayKyiv();
    const row = await db.prepare('SELECT balance, big_prizes_today AS big, day FROM bank WHERE id = 1').first<{ balance: number; big: number; day: string }>();
    if (!row) return { balance: cfg.bankStart, bigToday: 0 };
    // the daily counter itself is reset atomically by applyBank() on the next real open
    return { balance: row.balance, bigToday: row.day !== day ? 0 : row.big };
  }

  function applyBank(tx: Tx, paid: number, prizeValue: number) {
    const day = todayKyiv();
    const inc = prizeValue >= cfg.bigPrizeMinValue ? 1 : 0;
    tx.add('UPDATE bank SET balance = balance + ? - ?, big_prizes_today = CASE WHEN day = ? THEN big_prizes_today + ? ELSE ? END, day = ? WHERE id = 1',
      paid, prizeValue, day, inc, inc, day);
  }

  function ledger(tx: Tx, userId: string, type: string, amount: number, balanceAfter: number, ref: string) {
    tx.add('INSERT INTO ledger (id, user_id, type, amount, balance_after, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id(8), userId, type, amount, balanceAfter, ref, Date.now());
  }

  async function getOrCreateUser(userId: string): Promise<UserRow> {
    const existing = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<UserRow>();
    if (existing) return existing;
    await db.prepare('INSERT OR IGNORE INTO users (id, balance, client_seed, server_seed, nonce, created_at) VALUES (?, 0, ?, ?, 0, ?)')
      .bind(userId, newSeed(8), newSeed(32), Date.now()).run();
    return mustUser(userId);
  }
  async function mustUser(userId: string): Promise<UserRow> {
    const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<UserRow>();
    if (!u) throw new ApiError(404, 'NOT_FOUND');
    return u;
  }

  return { handle, db };
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
function deep(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const k of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}
function payloadUser(payload?: string): string | null {
  if (!payload) return null;
  try {
    const j = JSON.parse(payload);
    if (j && j.userId != null) return String(j.userId);
  } catch { /* payload may be plain id */ }
  return /^\d+$/.test(payload) ? payload : null;
}
