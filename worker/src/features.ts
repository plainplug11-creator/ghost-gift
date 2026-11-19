import type { Config } from './config.ts';
import { randomHex } from './crypto.ts';
import { Tx, todayKyiv } from './db.ts';
import { fairRoll, newSeed, seedHash } from './fair.ts';
import { hmacSha256, toHex } from './crypto.ts';
import {
  GAME_BETS, LUCK_HOURS, QUESTS, REF, SLOTS, WHEEL, levelInfo, luckPick, maxBet, questProgress, refLink, slotsFaces, slotsPick, streakReward, wheelPick,
  type GameId, type QuestId,
} from './games-rules.ts';
import { PRIZES } from './catalog.ts';
import { log } from './log.ts';
import { nextProgress, progressView, questsOf, weekKey, writeProgress, yesterdayKyiv, type ProgressRow } from './progress.ts';
import { hitRateLimit, inspectSpinTiming } from './risk.ts';
import { ApiError, getOrCreateUser, ledger, mustUser } from './users.ts';

export interface FeatureDeps {
  db: D1Database;
  cfg: Config;
  bankState(): Promise<{ balance: number; bigToday: number }>;
  applyBank(tx: Tx, paid: number, prizeValue: number): void; // games never use the cases' big-prize cap
}
const id = (n = 8) => randomHex(n);
const bankRules = (cfg: Config) => ({ reserve: cfg.bankReserve, dailyBigCap: cfg.dailyBigPrizeCap, bigMin: cfg.bigPrizeMinValue });

/** Independent cosmetic float from the same round secrets (slot faces). */
export async function fairRollTag(serverSeed: string, clientSeed: string, nonce: number, tag: string) {
  const hex = toHex(await hmacSha256(serverSeed, `${clientSeed}:${nonce}:${tag}`));
  return parseInt(hex.slice(0, 13), 16) / 2 ** 52;
}

/** Rarity of a game outcome for the feed / achievements (by multiplier). */
export const multRarity = (m: number) => (m >= 20 ? 'mythic' : m >= 10 ? 'legendary' : m >= 3 ? 'epic' : m >= 1.5 ? 'rare' : 'common');
const RANK: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };

export function createFeatures(d: FeatureDeps) {
  const { db, cfg } = d;

  /** Wheel / Slots round. Same provably-fair seed chain + nonce as cases. */
  async function spin(tx: Tx, first: boolean, userId: string, game: GameId, body: { bet?: number }) {
    const bet = Number(body.bet);
    if (!(GAME_BETS as readonly number[]).includes(bet)) throw new ApiError(400, 'NOT_FOUND', 'bad_bet');
    const u = await getOrCreateUser(db, userId) as ProgressRow;
    if (u.balance < bet) throw new ApiError(400, 'NO_BALANCE');
    if (first && (await hitRateLimit(db, `open:${userId}`, cfg.openLimitPerMin))) throw new ApiError(429, 'BUSY', 'rate_limited');
    if (u.risk_score >= 80 && u.flagged) throw new ApiError(429, 'BUSY', 'risk_blocked');
    if (first) await inspectSpinTiming(db, cfg, userId);
    const bank = await d.bankState();
    if (bet > maxBet(game, bank, bankRules(cfg))) throw new ApiError(409, 'LIMIT');

    const serverSeed = u.server_seed, clientSeed = u.client_seed, nonce = u.nonce + 1;
    const [hash, roll] = await Promise.all([seedHash(serverSeed), fairRoll(serverSeed, clientSeed, nonce)]);
    let mult = 0, outcome = '', index: number | undefined, faces: string[] | undefined;
    if (game === 'wheel') {
      index = wheelPick(roll); mult = WHEEL[index].m; outcome = `w${index}`;
    } else {
      const o = slotsPick(roll); mult = o.m; outcome = o.id;
      faces = slotsFaces(o, await fairRollTag(serverSeed, clientSeed, nonce, 'reels'));
    }
    const payout = Math.round(bet * mult);
    const rarity = multRarity(mult);
    const roundId = id(8);
    const now = Date.now();
    const prog = nextProgress(u, { wager: bet, game, mult, outcome, rarityRank: payout > bet ? RANK[rarity] : -1 }, now);
    let balance = u.balance - bet;
    ledger(tx, userId, `${game}_bet`, -bet, balance, roundId);
    if (payout) { balance += payout; ledger(tx, userId, `${game}_win`, payout, balance, roundId); }
    if (prog.bonus) { balance += prog.bonus; ledger(tx, userId, 'level_reward', prog.bonus, balance, `lvl${prog.levelTo}`); }
    tx.guardUser(userId, u.version);
    tx.add('UPDATE users SET balance = ?, server_seed = ?, nonce = ?, stats_opens = stats_opens + 1, stats_wins = stats_wins + ?, stats_best = MAX(stats_best, ?) WHERE id = ?',
      balance, newSeed(), nonce, payout >= bet ? 1 : 0, mult, userId);
    writeProgress(tx, userId, prog);
    tx.add(`INSERT INTO fairness_log (round_id, user_id, case_id, server_seed, server_seed_hash, client_seed, nonce, roll, prize_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, roundId, userId, game, serverSeed, hash, clientSeed, nonce, roll, outcome, now);
    tx.add('INSERT INTO plays (user_id, game, round_id, bet, payout, prize_id, rarity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', userId, game, roundId, bet, payout, outcome, rarity, now);
    d.applyBank(tx, bet, payout + prog.bonus);
    if (payout >= Math.max(cfg.bigPrizeMinValue, 5 * bet)) log('info', 'big_prize', { user: userId, game, mult, payout });
    return {
      roundId, game, bet, mult, payout, outcome, index, faces, balance,
      fairness: { serverSeedHash: hash, clientSeed, nonce, serverSeed },
      progress: progressOut(prog), unlocked: prog.unlocked,
    };
  }

  const progressOut = (p: ReturnType<typeof nextProgress>) => {
    const lv = levelInfo(p.xp);
    return { xp: p.xp, level: lv.level, into: lv.into, need: lv.need, levelUp: p.levelTo > p.levelFrom ? p.levelTo : 0, levelBonus: p.bonus, quests: p.quests };
  };

  /** Daily luck card: one draw per Kyiv day, 24 h boost on cheap cases. Not tied to the seed chain (no prize). */
  async function luckDraw(tx: Tx, userId: string) {
    const u = await mustUser(db, userId) as ProgressRow;
    const day = todayKyiv();
    if (u.luck_day === day) throw new ApiError(403, 'DAILY_COOLDOWN');
    const r = crypto.getRandomValues(new Uint32Array(2));
    const pct = luckPick((r[0] * 2 ** 21 + (r[1] >>> 11)) / 2 ** 53);
    const now = Date.now();
    const active = (u.luck_until ?? 0) > now ? u.luck_pct : 0;
    const keep = active > pct; // a stronger running boost (e.g. from the admin) is never downgraded
    const until = keep ? u.luck_until : now + LUCK_HOURS * 3600_000;
    tx.guardUser(userId, u.version);
    tx.add('UPDATE users SET luck_pct = ?, luck_until = ?, luck_day = ? WHERE id = ?', keep ? active : pct, until, day, userId);
    return { pct, active: keep ? active : pct, until };
  }

  async function streakClaim(tx: Tx, userId: string) {
    const u = await mustUser(db, userId) as ProgressRow;
    const now = Date.now();
    const day = todayKyiv(now);
    if (u.streak_day === day) throw new ApiError(403, 'DAILY_COOLDOWN');
    const count = u.streak_day === yesterdayKyiv(now) ? (u.streak_count ?? 0) + 1 : 1;
    const risky = u.flagged || u.risk_score >= cfg.reviewRiskScore;
    const bank = await d.bankState();
    const reward = risky || bank.balance < cfg.bankReserve ? 0 : streakReward(count); // free Stars only while the bank is healthy
    const prog = nextProgress(u, { wager: 0, game: 'case', bonusXp: 0, unlock: count >= 7 ? ['streak_7'] : [] }, now);
    // nextProgress counts 'case' events into quests only for wagers/daily — none here
    let balance = u.balance + reward;
    tx.guardUser(userId, u.version);
    if (reward) ledger(tx, userId, 'streak', reward, balance, `streak:${day}`);
    if (prog.bonus) { balance += prog.bonus; ledger(tx, userId, 'level_reward', prog.bonus, balance, `lvl${prog.levelTo}`); }
    tx.add('UPDATE users SET balance = ?, streak_day = ?, streak_count = ? WHERE id = ?', balance, day, count, userId);
    writeProgress(tx, userId, prog);
    if (reward + prog.bonus) d.applyBank(tx, 0, reward + prog.bonus);
    return { count, reward, balance, unlocked: prog.unlocked, progress: progressOut(prog) };
  }

  async function questClaim(tx: Tx, userId: string, qid: string) {
    const def = QUESTS.find((q) => q.id === qid);
    if (!def) throw new ApiError(404, 'NOT_FOUND');
    const u = await mustUser(db, userId) as ProgressRow;
    const q = questsOf(u);
    if (q.claimed.includes(def.id)) throw new ApiError(403, 'DAILY_COOLDOWN');
    if (questProgress(q, def) < def.goal) throw new ApiError(400, 'NOT_FOUND', 'quest_not_done');
    q.claimed = [...q.claimed, def.id as QuestId];
    const bank = await d.bankState();
    const questStars = bank.balance < cfg.bankReserve ? 0 : def.stars;
    const prog = nextProgress({ ...u, quests: JSON.stringify(q) }, { wager: 0, game: 'case', bonusXp: def.xp });
    const stars = questStars + prog.bonus;
    const balance = u.balance + stars;
    tx.guardUser(userId, u.version);
    if (questStars) ledger(tx, userId, 'quest', questStars, u.balance + questStars, `quest:${q.day}:${def.id}`);
    if (prog.bonus) ledger(tx, userId, 'level_reward', prog.bonus, balance, `lvl${prog.levelTo}`);
    tx.add('UPDATE users SET balance = ? WHERE id = ?', balance, userId);
    writeProgress(tx, userId, prog);
    if (stars) d.applyBank(tx, 0, stars);
    return { id: def.id, stars: questStars, xp: def.xp, balance, unlocked: prog.unlocked, progress: progressOut(prog) };
  }

  async function settings(userId: string, body: { hideFeed?: boolean; notify?: boolean }) {
    const sets: string[] = [], args: unknown[] = [];
    if (typeof body.hideFeed === 'boolean') { sets.push('hide_feed = ?'); args.push(body.hideFeed ? 1 : 0); }
    if (typeof body.notify === 'boolean') { sets.push('notify = ?'); args.push(body.notify ? 1 : 0); }
    if (sets.length) await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...args, userId).run();
    const u = await mustUser(db, userId) as ProgressRow;
    return { hideFeed: !!u.hide_feed, notify: !!u.notify, botStarted: !!u.bot_started };
  }

  /** Progress + game limits + referral stats for the client. */
  async function progress(userId: string) {
    const u = await getOrCreateUser(db, userId) as ProgressRow;
    const [bank, ref] = await Promise.all([
      d.bankState(),
      db.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?').bind(userId).first<{ n: number }>(),
    ]);
    return {
      ...progressView(u),
      limits: { wheel: maxBet('wheel', bank, bankRules(cfg)), slots: maxBet('slots', bank, bankRules(cfg)) },
      ref: { link: refLink(userId), friends: ref?.n ?? 0, earned: u.ref_earned ?? 0 },
      botStarted: !!u.bot_started,
    };
  }

  /** Real recent wins of everyone (names only, opt-out respected). */
  async function feed() {
    const r = await db.prepare(`SELECT p.id, p.game, p.prize_id AS prizeId, p.payout, p.bet, p.rarity, p.created_at AS at, u.tg_first_name AS name, u.hide_feed AS hidden
      FROM plays p JOIN users u ON u.id = p.user_id
      WHERE p.created_at > ? AND p.payout >= 15 AND p.payout > p.bet
      ORDER BY p.id DESC LIMIT 24`).bind(Date.now() - 7 * 86400_000)
      .all<{ id: number; game: string; prizeId: string; payout: number; bet: number; rarity: string; at: number; name: string | null; hidden: number }>();
    return (r.results ?? []).map((x) => ({
      id: x.id, game: x.game, prizeId: x.prizeId, payout: x.payout, rarity: x.rarity, at: x.at,
      mult: x.bet ? +(x.payout / x.bet).toFixed(1) : 0,
      name: x.hidden || !x.name ? null : x.name.slice(0, 14),
    }));
  }

  async function leaderboard(userId: string) {
    const wk = weekKey();
    const [top, me] = await Promise.all([
      db.prepare('SELECT id, tg_first_name AS name, hide_feed AS hidden, xp, week_xp AS score FROM users WHERE week_key = ? AND week_xp > 0 ORDER BY week_xp DESC, id LIMIT 20').bind(wk)
        .all<{ id: string; name: string | null; hidden: number; xp: number; score: number }>(),
      db.prepare('SELECT week_key, week_xp, xp FROM users WHERE id = ?').bind(userId).first<{ week_key: string | null; week_xp: number; xp: number }>(),
    ]);
    const myScore = me?.week_key === wk ? me.week_xp : 0;
    const rank = myScore > 0
      ? ((await db.prepare('SELECT COUNT(*) AS n FROM users WHERE week_key = ? AND (week_xp > ? OR (week_xp = ? AND id < ?))').bind(wk, myScore, myScore, userId).first<{ n: number }>())?.n ?? 0) + 1
      : 0;
    return {
      week: wk,
      top: (top.results ?? []).map((x, i) => ({ rank: i + 1, name: x.hidden || !x.name ? null : x.name.slice(0, 14), level: levelInfo(x.xp).level, score: x.score, me: x.id === userId })),
      me: { rank, score: myScore, level: levelInfo(me?.xp ?? 0).level },
    };
  }

  /** Sell several owned items at once (one atomic batch). */
  async function sellMany(tx: Tx, userId: string, uids: unknown) {
    if (!Array.isArray(uids) || !uids.length || uids.length > 60) throw new ApiError(400, 'NOT_FOUND', 'bad_uids');
    const list = [...new Set(uids.map(String))];
    const rows = (await db.prepare(`SELECT uid, prize_id AS prizeId, status, nft_id AS nftId, value FROM inventory WHERE user_id = ? AND uid IN (${list.map(() => '?').join(',')})`)
      .bind(userId, ...list).all<{ uid: string; prizeId: string; status: string; nftId: number | null; value: number | null }>()).results ?? [];
    if (rows.length !== list.length || rows.some((r) => r.status !== 'owned')) throw new ApiError(404, 'NOT_FOUND');
    const u = await mustUser(db, userId);
    let total = 0;
    tx.guardUser(userId, u.version);
    for (const it of rows) {
      const v = it.value ?? PRIZES[it.prizeId]?.value ?? 0;
      total += v;
      tx.add("INSERT INTO tx_guard (n) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM inventory WHERE uid = ? AND status = 'owned')", it.uid);
      tx.add("UPDATE inventory SET status = 'sold' WHERE uid = ?", it.uid);
      if (it.nftId) tx.add("UPDATE nft_stock SET status = 'in_stock', item_uid = NULL WHERE id = ? AND status = 'reserved'", it.nftId);
    }
    const balance = u.balance + total;
    tx.add('UPDATE users SET balance = ? WHERE id = ?', balance, userId);
    ledger(tx, userId, 'sell', total, balance, `many:${list.length}:${list[0]}`);
    return { balance, credited: total, sold: list };
  }

  /** Last rounds of this player in a game (history strip). */
  async function history(userId: string, game: string) {
    const r = await db.prepare('SELECT round_id AS roundId, bet, payout, prize_id AS outcome, created_at AS at FROM plays WHERE user_id = ? AND game = ? ORDER BY id DESC LIMIT 12')
      .bind(userId, game).all();
    return r.results ?? [];
  }

  return { spin, luckDraw, streakClaim, questClaim, settings, progress, feed, leaderboard, sellMany, history };
}

/**
 * Attach a referrer to a brand-new player (no rounds yet, created ≤ 15 min ago). Self-invites and
 * invites from an account seen on the same device are ignored.
 */
export async function attachReferral(db: D1Database, userId: string, ref: string | null, deviceId = '') {
  if (!ref || ref === userId) return false;
  const [u, r] = await Promise.all([
    db.prepare('SELECT created_at, stats_opens, referred_by FROM users WHERE id = ?').bind(userId).first<{ created_at: number; stats_opens: number; referred_by: string | null }>(),
    db.prepare('SELECT id, flagged FROM users WHERE id = ?').bind(ref).first<{ id: string; flagged: number }>(),
  ]);
  if (!u || !r || r.flagged || u.referred_by || u.stats_opens > 0 || Date.now() - u.created_at > 15 * 60_000) return false;
  if (deviceId) {
    const shared = await db.prepare('SELECT 1 AS x FROM fingerprints WHERE user_id = ? AND device_id = ? LIMIT 1').bind(ref, deviceId).first();
    if (shared) return false;
  }
  await db.prepare('UPDATE users SET referred_by = ? WHERE id = ? AND referred_by IS NULL').bind(ref, userId).run();
  log('info', 'referral_attached', { user: userId, ref });
  return true;
}

/** Referral payout for one paid top-up — added to the payment's batch (charge id = idempotency). */
export async function referralWrites(db: D1Database, tx: Tx, userId: string, chargeId: string, stars: number) {
  const u = await db.prepare('SELECT referred_by, created_at FROM users WHERE id = ?').bind(userId).first<{ referred_by: string | null; created_at: number }>();
  if (!u?.referred_by || Date.now() - u.created_at > REF.days * 86400_000) return null;
  const [ref, paid, prev] = await Promise.all([
    db.prepare('SELECT id, flagged FROM users WHERE id = ?').bind(u.referred_by).first<{ id: string; flagged: number }>(),
    db.prepare('SELECT COALESCE(SUM(stars), 0) AS s FROM ref_rewards WHERE referee = ?').bind(userId).first<{ s: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM payments WHERE user_id = ?').bind(userId).first<{ n: number }>(),
  ]);
  if (!ref || ref.flagged) return null;
  const toRef = Math.max(0, Math.min(Math.floor((stars * REF.pct) / 100), REF.capPerFriend - (paid?.s ?? 0)));
  const welcome = (prev?.n ?? 0) === 0 ? Math.min(Math.floor((stars * REF.welcomePct) / 100), REF.welcomeCap) : 0;
  if (!toRef && !welcome) return null;
  tx.add('INSERT INTO ref_rewards (charge_id, referrer, referee, stars, welcome, created_at) VALUES (?, ?, ?, ?, ?, ?)', chargeId, ref.id, userId, toRef, welcome, Date.now());
  if (toRef) {
    tx.add('UPDATE users SET balance = balance + ?, ref_earned = ref_earned + ?, version = version + 1 WHERE id = ?', toRef, toRef, ref.id);
    tx.add('INSERT INTO ledger (id, user_id, type, amount, balance_after, ref, created_at) SELECT ?, ?, ?, ?, balance, ?, ? FROM users WHERE id = ?',
      randomHex(8), ref.id, 'ref_bonus', toRef, chargeId, Date.now(), ref.id);
    tx.add("UPDATE users SET ach = CASE WHEN instr(ach, 'friend') > 0 THEN ach WHEN ach = '' THEN 'friend' ELSE ach || ',friend' END WHERE id = ?", ref.id);
  }
  return { referrer: ref.id, toRef, welcome };
}
