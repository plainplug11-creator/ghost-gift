/**
 * Shared rules for the Wheel, Slots, Luck card and the progression layer (levels, streak, quests,
 * achievements, referrals). Imported by the client (display, mock) AND the worker (real outcomes),
 * so the odds shown in the app are exactly the ones the server rolls.
 *
 * Economy (verified by `cd worker && npm run sim`):
 *   - Wheel RTP 86.7 %, Slots RTP 86.5 % (inside the 85–88 % band of the cases).
 *   - Max bet is limited live by the bank: maxMult × bet must fit above the reserve → the bank can't go negative.
 *   - Every bonus is either tiny (streak ≤ 18⭐/week), paid out of the house edge of the activity it
 *     requires (quests, level rakeback 1 %), or funded by real revenue (referral = % of a friend's top-up).
 */

/** All multipliers (0.5, 1.2, 1.5 …) give whole Stars on every bet. */
export const GAME_BETS = [10, 20, 50, 100, 200, 500] as const;
export type GameId = 'wheel' | 'slots';

// ───────────── Wheel ─────────────
/** Segments clockwise from the top. weight ∝ arc size on screen ∝ probability (honest wheel). Units: 1/1000. */
export interface WheelSeg { m: number; w: number }
export const WHEEL: WheelSeg[] = [
  { m: 10, w: 6 }, { m: 0, w: 63 }, { m: 1.2, w: 54 }, { m: 0.5, w: 53 }, { m: 2, w: 45 },
  { m: 0, w: 63 }, { m: 1.5, w: 55 }, { m: 0.5, w: 53 }, { m: 0, w: 63 }, { m: 3, w: 35 },
  { m: 0.5, w: 52 }, { m: 1.2, w: 53 }, { m: 0, w: 63 }, { m: 5, w: 12 }, { m: 0, w: 63 },
  { m: 1.5, w: 55 }, { m: 0.5, w: 52 }, { m: 2, w: 45 }, { m: 1.2, w: 53 }, { m: 0, w: 62 },
];
export const WHEEL_TOTAL = WHEEL.reduce((s, x) => s + x.w, 0); // 1000
export const WHEEL_MAX = Math.max(...WHEEL.map((s) => s.m));
export function wheelPick(roll: number): number {
  let x = roll * WHEEL_TOTAL;
  for (let i = 0; i < WHEEL.length; i++) { x -= WHEEL[i].w; if (x < 0) return i; }
  return WHEEL.length - 1;
}
/** Start/end angle (deg, clockwise from 12 o'clock) of a segment. */
export function wheelArc(i: number) {
  let a = 0;
  for (let k = 0; k < i; k++) a += WHEEL[k].w;
  return { from: (a / WHEEL_TOTAL) * 360, to: ((a + WHEEL[i].w) / WHEEL_TOTAL) * 360 };
}

// ───────────── Slots ─────────────
export type SlotSym = 'ghost' | 'seven' | 'crown' | 'diamond' | 'leaf' | 'acorn' | 'heart';
export const SLOT_SYMS: SlotSym[] = ['ghost', 'seven', 'crown', 'diamond', 'leaf', 'acorn', 'heart'];
/** Outcome table (one roll → one outcome; the reels only illustrate it). Units: 1/100000. */
export interface SlotOutcome { id: string; m: number; w: number }
export const SLOTS: SlotOutcome[] = [
  { id: 'g3', m: 40, w: 150 },     // 👻👻👻 jackpot
  { id: 's3', m: 20, w: 400 },     // 7 7 7
  { id: 'c3', m: 10, w: 800 },     // three crowns
  { id: 'd3', m: 5, w: 2000 },     // three diamonds
  { id: 'f3', m: 3, w: 5000 },     // three of leaf / acorn / heart
  { id: 'g2', m: 2, w: 6000 },     // two ghosts anywhere
  { id: 'g1', m: 1, w: 27500 },    // one ghost anywhere = bet back
  { id: 'x', m: 0, w: 58150 },     // no win
];
export const SLOTS_TOTAL = SLOTS.reduce((s, x) => s + x.w, 0); // 100000
export const SLOTS_MAX = Math.max(...SLOTS.map((s) => s.m));
export function slotsPick(roll: number): SlotOutcome {
  let x = roll * SLOTS_TOTAL;
  for (const o of SLOTS) { x -= o.w; if (x < 0) return o; }
  return SLOTS[SLOTS.length - 1];
}
/**
 * Reel faces that illustrate an outcome. `r` is a second, independent fair float (cosmetic only):
 * a deterministic PRNG seeded by it picks positions/symbols uniformly among the combos of that outcome.
 */
export function slotsFaces(o: SlotOutcome, r: number): [SlotSym, SlotSym, SlotSym] {
  let s = Math.floor(r * 2 ** 31) || 1;
  const rnd = () => { s = (s * 48271) % 2147483647; return s / 2147483647; };
  const pickOf = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length) % a.length];
  const non = SLOT_SYMS.filter((x) => x !== 'ghost');
  const fruit: SlotSym[] = ['leaf', 'acorn', 'heart'];
  switch (o.id) {
    case 'g3': return ['ghost', 'ghost', 'ghost'];
    case 's3': return ['seven', 'seven', 'seven'];
    case 'c3': return ['crown', 'crown', 'crown'];
    case 'd3': return ['diamond', 'diamond', 'diamond'];
    case 'f3': { const f = pickOf(fruit); return [f, f, f]; }
    case 'g2': { const out: SlotSym[] = ['ghost', 'ghost', 'ghost']; out[Math.floor(rnd() * 3) % 3] = pickOf(non); return out as [SlotSym, SlotSym, SlotSym]; }
    case 'g1': {
      const out: SlotSym[] = [pickOf(non), pickOf(non), pickOf(non)];
      out[Math.floor(rnd() * 3) % 3] = 'ghost';
      return out as [SlotSym, SlotSym, SlotSym];
    }
    default: {
      for (let i = 0; i < 50; i++) {
        const a = pickOf(non), b = pickOf(non), c = pickOf(non);
        if (!(a === b && b === c)) return [a, b, c];
      }
      return ['seven', 'crown', 'leaf'];
    }
  }
}

/** RTP of a weighted multiplier table. */
export const tableRtp = (t: { m: number; w: number }[]) => t.reduce((s, x) => s + x.m * x.w, 0) / t.reduce((s, x) => s + x.w, 0);
export const GAME_MAX: Record<GameId, number> = { wheel: WHEEL_MAX, slots: SLOTS_MAX };

/**
 * Largest bet the bank can cover right now (0 = game paused): the top payout must leave the bank above
 * the reserve, so the bank can't go negative. (The daily big-prize cap stays a case-only rule: game wins
 * are capped by this bet limit instead, and don't use up the cases' cap.)
 */
export function maxBet(game: GameId, bank: { balance: number; bigToday?: number }, rules: { reserve: number }): number {
  const mult = GAME_MAX[game];
  let best = 0;
  for (const b of GAME_BETS) if (mult * b <= bank.balance + b - rules.reserve) best = b;
  return best;
}

// ───────────── Luck card ─────────────
/** One free draw per Kyiv day. Boost lasts 24 h and applies to cases ≤ LUCK.maxCasePrice (see catalog.LUCK). */
export const LUCK_CARDS = [
  { pct: 3, w: 45 }, { pct: 5, w: 30 }, { pct: 7, w: 17 }, { pct: 10, w: 8 },
] as const;
export const LUCK_HOURS = 24;
export function luckPick(r: number): number {
  const total = LUCK_CARDS.reduce((s, x) => s + x.w, 0);
  let x = r * total;
  for (const c of LUCK_CARDS) { x -= c.w; if (x < 0) return c.pct; }
  return LUCK_CARDS[0].pct;
}

// ───────────── Levels / XP ─────────────
/** XP: 1 per Star wagered in any game + small bonuses. XP needed to go from level L to L+1. */
export const LEVEL_MAX = 50;
export const xpStep = (level: number) => Math.round(100 * Math.pow(level, 1.5));
export function levelInfo(xp: number) {
  let level = 1, base = 0;
  while (level < LEVEL_MAX && xp >= base + xpStep(level)) { base += xpStep(level); level++; }
  const need = level >= LEVEL_MAX ? 0 : xpStep(level);
  return { level, into: xp - base, need, progress: need ? (xp - base) / need : 1 };
}
/** Reward for reaching `level`: 1 % of the wager that step took (house edge is ≥ 12 %). */
export const levelReward = (level: number) => (level <= 1 ? 0 : Math.max(1, Math.floor(xpStep(level - 1) * 0.01)));
/** Ghost collection: tinted ghosts unlocked by level. */
export const GHOSTS = [
  { id: 'classic', level: 1, hue: 0 },
  { id: 'mint', level: 3, hue: -70 },
  { id: 'rose', level: 5, hue: 70 },
  { id: 'aqua', level: 10, hue: -120 },
  { id: 'gold', level: 20, hue: 160 },
] as const;

// ───────────── Daily streak ─────────────
/** 7-day calendar, claimed once per Kyiv day; missing a day restarts at day 1. */
export const STREAK_REWARDS = [1, 1, 2, 2, 3, 3, 6] as const;
export const streakReward = (day: number) => STREAK_REWARDS[(Math.max(1, day) - 1) % STREAK_REWARDS.length];

// ───────────── Daily quests ─────────────
export type QuestId = 'daily' | 'open3' | 'wheel3' | 'slots3' | 'wager100' | 'all';
export interface QuestDef { id: QuestId; goal: number; stars: number; xp: number; metric: 'daily' | 'opens' | 'wheel' | 'slots' | 'wager' | 'done' }
/** Rewards stay below the house edge of the activity each quest needs. */
export const QUESTS: QuestDef[] = [
  { id: 'daily', goal: 1, stars: 0, xp: 15, metric: 'daily' },
  { id: 'open3', goal: 3, stars: 2, xp: 10, metric: 'opens' },
  { id: 'wheel3', goal: 3, stars: 1, xp: 10, metric: 'wheel' },
  { id: 'slots3', goal: 3, stars: 1, xp: 10, metric: 'slots' },
  { id: 'wager100', goal: 100, stars: 5, xp: 25, metric: 'wager' },
  { id: 'all', goal: 5, stars: 2, xp: 30, metric: 'done' },
];
export interface QuestState { day: string; daily: number; opens: number; wheel: number; slots: number; wager: number; claimed: QuestId[] }
export const emptyQuests = (day: string): QuestState => ({ day, daily: 0, opens: 0, wheel: 0, slots: 0, wager: 0, claimed: [] });
export function questProgress(q: QuestState, def: QuestDef): number {
  if (def.metric === 'done') return QUESTS.filter((d) => d.id !== 'all' && q.claimed.includes(d.id)).length;
  return q[def.metric];
}

// ───────────── Achievements (badges + XP, no Stars) ─────────────
export type AchId = 'first_open' | 'opens_10' | 'opens_100' | 'opens_1000' | 'epic' | 'legend' | 'mythic' | 'nft' | 'wheel_x10' | 'slots_jackpot' | 'streak_7' | 'level_10' | 'topup' | 'friend' | 'withdraw';
export const ACHIEVEMENTS: { id: AchId; xp: number; icon: string }[] = [
  { id: 'first_open', xp: 10, icon: 'gift' },
  { id: 'opens_10', xp: 25, icon: 'spins' },
  { id: 'opens_100', xp: 100, icon: 'spins' },
  { id: 'opens_1000', xp: 500, icon: 'crown' },
  { id: 'epic', xp: 25, icon: 'rocket' },
  { id: 'legend', xp: 50, icon: 'cup' },
  { id: 'mythic', xp: 100, icon: 'crown' },
  { id: 'nft', xp: 200, icon: 'diamond' },
  { id: 'wheel_x10', xp: 100, icon: 'bolt' },
  { id: 'slots_jackpot', xp: 200, icon: 'seven' },
  { id: 'streak_7', xp: 50, icon: 'leaf' },
  { id: 'level_10', xp: 100, icon: 'luck' },
  { id: 'topup', xp: 20, icon: 'heart' },
  { id: 'friend', xp: 50, icon: 'bear' },
  { id: 'withdraw', xp: 30, icon: 'ring' },
];

// ───────────── Referrals ─────────────
/** Friend's top-ups during the first REF_DAYS: the inviter gets REF_PCT % (cap per friend); the friend +REF_WELCOME_PCT % on the first one. */
export const REF = { pct: 10, welcomePct: 10, days: 30, capPerFriend: 500, welcomeCap: 250 } as const;
export const refCode = (userId: string | number) => `ref_${userId}`;
export const parseRef = (s: string | null | undefined) => { const m = /^ref_(\d{3,15})$/.exec(String(s ?? '')); return m ? m[1] : null; };

/** Public link to the bot (referral deep link through /start). */
export const BOT_USERNAME = 'GhostGift_Game';
export const refLink = (userId: string | number) => `https://t.me/${BOT_USERNAME}?start=${refCode(userId)}`;
