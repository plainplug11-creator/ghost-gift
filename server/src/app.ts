import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AuthError, verifyInitData } from './auth.ts';
import type { Config } from './config.ts';
import { CASES, PRIZES, PREMIUM_TIERS, caseById, type Prize } from './catalog.ts';
import { todayKyiv, withTx } from './db.ts';
import { fairRoll, newSeed, seedHash, verifyFair } from './fair.ts';
import { bumpRisk, hitRateLimit, inspectSpinTiming, recordFingerprint } from './risk.ts';

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
const RARITY_RANK: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
const id = (n = 16) => randomBytes(n).toString('hex');
const header = (h: Record<string, string>, k: string) => {
  const want = k.toLowerCase();
  for (const [x, v] of Object.entries(h)) if (x.toLowerCase() === want) return v;
  return '';
};

export function createApp(db: DatabaseSync, cfg: Config) {
  ensureBank(db, cfg);

  async function handle(req: AppReq): Promise<AppRes> {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method.toUpperCase();
    if (method === 'OPTIONS') return { status: 204, headers: cors(), body: '' };
    try {
      if (method === 'GET' && path === '/health') return ok({ ok: true });
      if (method === 'GET' && path === '/v1/cases') return ok({ cases: CASES });
      if (method === 'POST' && path === '/v1/fairness/verify') return ok(verifyFair(json(req)));
      if (method === 'POST' && (path === '/v1/webhook/telegram' || path === '/v1/telegram/payment')) {
        return handleWebhook(req);
      }
      const userId = authorize(req);
      const deviceId = header(req.headers, 'x-device-id');
      recordFingerprint(db, cfg, userId, deviceId, req.ip);
      if (hitRateLimit(db, `api:${userId}`, cfg.rateLimitPerMin)) throw new ApiError(429, 'BUSY', 'rate_limited');

      if (method === 'POST' && path === '/v1/bootstrap') return ok(bootstrap(userId));
      if (method === 'GET' && path === '/v1/next-round') return ok(nextRound(userId));
      if (method === 'GET' && path === '/v1/inventory') return ok({ inventory: inventory(userId) });
      if (method === 'POST' && path === '/v1/open') return mutate(userId, req, () => openCase(userId, json(req)));
      if (method === 'POST' && path === '/v1/sell') return mutate(userId, req, () => sell(userId, json(req).uid));
      if (method === 'POST' && path === '/v1/withdraw') return mutate(userId, req, () => withdraw(userId, json(req).uid));
      if (method === 'POST' && path === '/v1/buy-premium') return mutate(userId, req, () => buyPremium(userId, json(req).months));
      return { status: 404, headers: cors(), body: { error: 'NOT_FOUND' } };
    } catch (e) {
      if (e instanceof AuthError) return { status: 401, headers: cors(), body: { error: e.code } };
      if (e instanceof ApiError) return { status: e.status, headers: cors(), body: { error: e.code } };
      console.error('server error', e instanceof Error ? e.message : 'unknown');
      return { status: 500, headers: cors(), body: { error: 'BUSY' } };
    }
  }

  function authorize(req: AppReq): string {
    const auth = header(req.headers, 'authorization');
    const raw = auth.toLowerCase().startsWith('tma ') ? auth.slice(4) : header(req.headers, 'x-init-data') || '';
    const { user } = verifyInitData(raw, cfg.botToken, cfg.authMaxAgeSec);
    return String(user.id);
  }

  function mutate(userId: string, req: AppReq, fn: () => unknown): AppRes {
    const key = header(req.headers, 'x-idempotency-key') || (json(req).idempotencyKey as string | undefined);
    const body = withTx(db, () => {
      if (key) {
        const hit = db.prepare('SELECT response FROM idempotency WHERE user_id = ? AND key = ?').get(userId, key) as { response: string } | undefined;
        if (hit) return JSON.parse(hit.response);
      }
      const out = fn();
      if (key) {
        db.prepare('INSERT INTO idempotency (key, user_id, response, created_at) VALUES (?, ?, ?, ?)').run(key, userId, JSON.stringify(out), Date.now());
      }
      return out;
    });
    return ok(body);
  }

  function bootstrap(userId: string) {
    const u = getOrCreateUser(userId);
    return {
      balance: u.balance,
      inventory: inventory(userId),
      dailyReadyAt: u.daily_ready_at,
      fairness: { serverSeedHash: seedHash(u.server_seed), clientSeed: u.client_seed, nonce: u.nonce + 1 },
      riskScore: u.risk_score,
    };
  }

  function nextRound(userId: string) {
    const u = getOrCreateUser(userId);
    return { serverSeedHash: seedHash(u.server_seed), clientSeed: u.client_seed, nonce: u.nonce + 1 };
  }

  function inventory(userId: string) {
    return (db.prepare('SELECT uid, prize_id AS prizeId, case_id AS caseId, won_at AS wonAt, status FROM inventory WHERE user_id = ? AND status != ? ORDER BY won_at DESC')
      .all(userId, 'sold') as { uid: string; prizeId: string; caseId: string; wonAt: number; status: string }[]);
  }

  function openCase(userId: string, body: { caseId?: string; demo?: boolean }) {
    const c = caseById(body.caseId || '');
    if (!c) throw new ApiError(404, 'NOT_FOUND');
    const demo = !!body.demo;
    const u = getOrCreateUser(userId);
    if (!demo) {
      if (c.price === 0) {
        if (u.daily_ready_at > Date.now()) throw new ApiError(403, 'DAILY_COOLDOWN');
      } else if (u.balance < c.price) throw new ApiError(400, 'NO_BALANCE');
      if (hitRateLimit(db, `open:${userId}`, cfg.openLimitPerMin)) throw new ApiError(429, 'BUSY', 'rate_limited');
      if (u.risk_score >= 80 && u.flagged) throw new ApiError(429, 'BUSY', 'risk_blocked');
      inspectSpinTiming(db, cfg, userId);
    }

    if (demo) {
      const seed = newSeed();
      const fairness = { serverSeedHash: seedHash(seed), clientSeed: u.client_seed, nonce: 0, serverSeed: seed };
      const prize = pickPrize(c.id, fairRoll(seed, u.client_seed, 0), bankState());
      return { roundId: id(8), caseId: c.id, demo: true, prize, balance: u.balance, fairness };
    }

    const serverSeed = u.server_seed;
    const nonce = u.nonce + 1;
    const clientSeed = u.client_seed;
    const hash = seedHash(serverSeed);
    const roll = fairRoll(serverSeed, clientSeed, nonce);
    const prize = pickPrize(c.id, roll, bankState());
    const nextSeed = newSeed();
    const now = Date.now();
    const roundId = id(8);

    let balance = u.balance - c.price;
    let credited: number | undefined;
    let itemUid: string | undefined;
    if (c.price === 0) {
      db.prepare('UPDATE users SET daily_ready_at = ? WHERE id = ?').run(now + DAY, userId);
    }
    if (c.price) ledger(userId, 'case_open', -c.price, balance, roundId);
    const best = c.price ? Math.max(u.stats_best, +(prize.value / c.price).toFixed(1)) : u.stats_best;
    const wins = u.stats_wins + (prize.value >= c.price ? 1 : 0);
    if (prize.kind === 'stars') {
      balance += prize.value;
      credited = prize.value;
      ledger(userId, 'prize_stars', prize.value, balance, roundId);
    } else {
      itemUid = id(6);
      db.prepare('INSERT INTO inventory (uid, user_id, prize_id, case_id, won_at, status) VALUES (?, ?, ?, ?, ?, ?)')
        .run(itemUid, userId, prize.id, c.id, now, 'owned');
    }
    db.prepare(`UPDATE users SET balance = ?, server_seed = ?, nonce = ?, stats_opens = stats_opens + 1, stats_wins = ?, stats_best = ? WHERE id = ?`)
      .run(balance, nextSeed, nonce, wins, best, userId);
    db.prepare(`INSERT INTO fairness_log (round_id, user_id, case_id, server_seed, server_seed_hash, client_seed, nonce, roll, prize_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(roundId, userId, c.id, serverSeed, hash, clientSeed, nonce, roll, prize.id, now);
    applyBank(c.price, prize.value);

    return {
      roundId, caseId: c.id, demo: false, prize, itemUid, credited, balance,
      dailyReadyAt: c.price === 0 ? now + DAY : u.daily_ready_at,
      fairness: { serverSeedHash: hash, clientSeed, nonce, serverSeed },
    };
  }

  function sell(userId: string, uid: string) {
    if (!uid) throw new ApiError(404, 'NOT_FOUND');
    const it = db.prepare('SELECT uid, prize_id AS prizeId, status FROM inventory WHERE uid = ? AND user_id = ?').get(uid, userId) as { uid: string; prizeId: string; status: string } | undefined;
    if (!it || it.status !== 'owned') throw new ApiError(404, 'NOT_FOUND');
    const value = PRIZES[it.prizeId]?.value;
    if (value == null) throw new ApiError(404, 'NOT_FOUND');
    const u = mustUser(userId);
    const balance = u.balance + value;
    db.prepare("UPDATE inventory SET status = 'sold' WHERE uid = ?").run(uid);
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(balance, userId);
    ledger(userId, 'sell', value, balance, uid);
    return { balance, credited: value };
  }

  function withdraw(userId: string, uid: string) {
    if (!uid) throw new ApiError(404, 'NOT_FOUND');
    const it = db.prepare('SELECT uid, prize_id AS prizeId, status FROM inventory WHERE uid = ? AND user_id = ?').get(uid, userId) as { uid: string; prizeId: string; status: string } | undefined;
    if (!it || it.status !== 'owned') throw new ApiError(404, 'NOT_FOUND');
    const prize = PRIZES[it.prizeId];
    if (!prize) throw new ApiError(404, 'NOT_FOUND');
    const u = mustUser(userId);
    const ageH = (Date.now() - u.created_at) / 3600000;
    const reasons: string[] = [];
    if (prize.value >= cfg.withdrawReviewMin) reasons.push('large');
    if (ageH < cfg.newAccountHours) reasons.push('new_account');
    if (u.risk_score >= cfg.reviewRiskScore || u.flagged) reasons.push('high_risk');
    const status = reasons.length ? 'review' : 'approved';
    db.prepare("UPDATE inventory SET status = 'withdrawing' WHERE uid = ?").run(uid);
    db.prepare('INSERT INTO withdrawals (id, user_id, item_uid, prize_id, value, status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id(8), userId, uid, prize.id, prize.value, status, reasons.join(',') || null, Date.now());
    return { status: 'queued' as const, review: status === 'review' };
  }

  function buyPremium(userId: string, months: number) {
    const tier = PREMIUM_TIERS.find((x) => x.months === months);
    if (!tier) throw new ApiError(404, 'NOT_FOUND');
    const u = mustUser(userId);
    if (u.balance < tier.price) throw new ApiError(400, 'NO_BALANCE');
    const balance = u.balance - tier.price;
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(balance, userId);
    ledger(userId, 'premium_buy', -tier.price, balance, `prem${months}`);
    return { status: 'queued' as const, balance };
  }

  function handleWebhook(req: AppReq): AppRes {
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
      const result = withTx(db, () => creditPayment(userId, chargeId, stars));
      return ok(result);
    }
    const refund = deep(update, 'message.refunded_payment') || update.refunded_payment;
    if (refund && typeof refund === 'object') {
      const p = refund as { telegram_payment_charge_id?: string; total_amount?: number };
      if (!p.telegram_payment_charge_id) throw new ApiError(400, 'NOT_FOUND', 'bad_refund');
      const result = withTx(db, () => applyRefund(p.telegram_payment_charge_id!, Number(p.total_amount) || 0));
      return ok(result);
    }
    return ok({ ignored: true });
  }

  function creditPayment(userId: string, chargeId: string, stars: number) {
    const existing = db.prepare('SELECT charge_id FROM payments WHERE charge_id = ?').get(chargeId);
    if (existing) return { status: 'duplicate', chargeId };
    getOrCreateUser(userId);
    const u = mustUser(userId);
    const balance = u.balance + stars;
    db.prepare('INSERT INTO payments (charge_id, user_id, stars, created_at, refunded) VALUES (?, ?, ?, ?, 0)').run(chargeId, userId, stars, Date.now());
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(balance, userId);
    ledger(userId, 'stars_payment', stars, balance, chargeId);
    return { status: 'credited', chargeId, balance };
  }

  function applyRefund(chargeId: string, amount: number) {
    const row = db.prepare('SELECT charge_id, user_id, stars, refunded FROM payments WHERE charge_id = ?').get(chargeId) as { charge_id: string; user_id: string; stars: number; refunded: number } | undefined;
    if (!row) return { status: 'unknown_charge', chargeId };
    if (row.refunded) return { status: 'already_refunded', chargeId };
    const stars = amount || row.stars;
    const u = mustUser(row.user_id);
    const balance = Math.max(0, u.balance - stars);
    db.prepare('UPDATE payments SET refunded = 1 WHERE charge_id = ?').run(chargeId);
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(balance, row.user_id);
    bumpRisk(db, row.user_id, 30, true);
    ledger(row.user_id, 'refund', -stars, balance, chargeId);
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

  function bankState() {
    const day = todayKyiv();
    const row = db.prepare('SELECT balance, big_prizes_today AS big, day FROM bank WHERE id = 1').get() as { balance: number; big: number; day: string };
    if (row.day !== day) {
      db.prepare('UPDATE bank SET big_prizes_today = 0, day = ? WHERE id = 1').run(day);
      return { balance: row.balance, bigToday: 0 };
    }
    return { balance: row.balance, bigToday: row.big };
  }

  function applyBank(paid: number, prizeValue: number) {
    const day = todayKyiv();
    const inc = prizeValue >= cfg.bigPrizeMinValue ? 1 : 0;
    db.prepare(`UPDATE bank SET balance = balance + ? - ?, big_prizes_today = CASE WHEN day = ? THEN big_prizes_today + ? ELSE ? END, day = ? WHERE id = 1`)
      .run(paid, prizeValue, day, inc, inc, day);
  }

  function ledger(userId: string, type: string, amount: number, balanceAfter: number, ref: string) {
    db.prepare('INSERT INTO ledger (id, user_id, type, amount, balance_after, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id(8), userId, type, amount, balanceAfter, ref, Date.now());
  }

  function getOrCreateUser(userId: string) {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (existing) return existing;
    const now = Date.now();
    db.prepare(`INSERT INTO users (id, balance, client_seed, server_seed, nonce, created_at) VALUES (?, 0, ?, ?, 0, ?)`)
      .run(userId, newSeed(8), newSeed(32), now);
    return mustUser(userId);
  }
  function mustUser(userId: string) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!u) throw new ApiError(404, 'NOT_FOUND');
    return u;
  }

  return { handle, db };
}

interface UserRow {
  id: string; balance: number; client_seed: string; server_seed: string; nonce: number;
  created_at: number; daily_ready_at: number; risk_score: number; flagged: number;
  stats_opens: number; stats_wins: number; stats_best: number;
}

function ensureBank(db: DatabaseSync, cfg: Config) {
  db.prepare('INSERT OR IGNORE INTO bank (id, balance, big_prizes_today, day) VALUES (1, ?, 0, ?)').run(cfg.bankStart, todayKyiv());
}
function json(req: AppReq): Record<string, any> {
  if (!req.body) return {};
  try { return JSON.parse(req.body); } catch { throw new ApiError(400, 'NOT_FOUND', 'bad_json'); }
}
function ok(body: unknown): AppRes { return { status: 200, headers: cors(), body }; }
function cors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Device-Id, X-Idempotency-Key, X-Init-Data, X-Telegram-Bot-Api-Secret-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
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
