import { CASES, NFT_DROPS, PRIZES, PREMIUM_TIERS, caseById, liveDrops } from './catalog';
import type { GameApi } from './index';
import { ApiError } from './types';
import type { AchId, Fairness, InvItem, LevelDelta, OpenResult, Prize, ProgressInfo, QuestState, SpinResult } from './types';
import { RARITY_RANK } from './types';
import { ACHIEVEMENTS, GAME_BETS, QUESTS, WHEEL, emptyQuests, levelInfo, levelReward, luckPick, maxBet, questProgress, refLink, slotsFaces, slotsPick, streakReward, wheelPick, type GameId } from './games';
import { applyProgress, patchProgress, setProgress, flushCelebrations } from '../core/progress';
import { store } from '../core/store';

/**
 * ⚠️ MOCK BACKEND — dev / demo only.
 * Everything here runs in the browser and is therefore NOT trustworthy:
 * a player can edit localStorage or this code. In production every method is
 * an authenticated request (Telegram initData verified on the server) and:
 *   - RNG + balance + inventory + limits live ONLY on the server (DB transaction + row lock)
 *   - openCase is idempotent by roundId; rate-limited per user
 *   - the client receives the outcome and just animates it
 * The provably-fair scheme below mirrors what the server will do, so the UI
 * hooks (hash before, seed after) are already in place.
 */
const LS = 'gg.mock.v1';

/** Mock mode shows every NFT collection as in stock (the real server lists only stocked ones). */
export function mockNftStock() {
  for (const c of CASES) c.drops = liveDrops(c, { nftInStock: Object.keys(NFT_DROPS[c.id] ?? {}) });
}
const DAY = 24 * 60 * 60 * 1000;

interface Meta { xp: number; ach: AchId[]; quests: QuestState | null; streakDay: string; streakCount: number; luckPct: number; luckUntil: number; luckDay: string; hideFeed: boolean; notify: boolean }
interface State { balance: number; inv: InvItem[]; nonce: number; clientSeed: string; serverSeed: string; stats: { opens: number; wins: number; best: number }; meta?: Meta }

const rnd = (n = 16) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
const load = (): State => {
  try { const s = JSON.parse(localStorage.getItem(LS) || ''); if (s && typeof s.balance === 'number') return s; } catch { /* fresh */ }
  return { balance: 1250, inv: [], nonce: 0, clientSeed: rnd(8), serverSeed: rnd(32), stats: { opens: 0, wins: 0, best: 0 } };
};
let S = load();
const kyivDay = (t = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
const M = (): Meta => (S.meta ??= { xp: 0, ach: [], quests: null, streakDay: '', streakCount: 0, luckPct: 0, luckUntil: 0, luckDay: '', hideFeed: false, notify: false });
const questsNow = () => { const m = M(); const d = kyivDay(); if (!m.quests || m.quests.day !== d) m.quests = emptyQuests(d); return m.quests; };
function mockProgressInfo(): ProgressInfo {
  const m = M(); const lv = levelInfo(m.xp); const day = kyivDay();
  const alive = m.streakDay === day || m.streakDay === kyivDay(Date.now() - 86400_000);
  const luckOn = m.luckUntil > Date.now();
  return {
    xp: m.xp, level: lv.level, into: lv.into, need: lv.need,
    streak: { count: alive ? m.streakCount : 0, claimedToday: m.streakDay === day },
    quests: questsNow(), ach: [...m.ach],
    luck: { pct: luckOn ? m.luckPct : 0, until: luckOn ? m.luckUntil : 0, drawnToday: m.luckDay === day },
    settings: { hideFeed: m.hideFeed, notify: m.notify },
    limits: { wheel: maxBet('wheel', { balance: 50_000 }, { reserve: 3000 }), slots: maxBet('slots', { balance: 9000 }, { reserve: 3000 }) },
    ref: { link: refLink(1), friends: 3, earned: 120 },
    botStarted: true,
  };
}
/** Mirrors worker/src/progress.ts nextProgress (simplified, demo only). */
function mockProgress(ev: { wager: number; game: 'case' | GameId; daily?: boolean; rank?: number; nft?: boolean; mult?: number; outcome?: string; bonusXp?: number; unlock?: AchId[] }): { delta: LevelDelta; unlocked: AchId[]; bonus: number } {
  const m = M(); const q = questsNow(); const has = new Set(m.ach); const unlocked: AchId[] = [];
  const un = (id: AchId, c = true) => { if (c && !has.has(id)) { has.add(id); unlocked.push(id); } };
  if (ev.daily) q.daily++;
  if (ev.game === 'case' && !ev.daily && ev.wager > 0) q.opens++;
  if (ev.game === 'wheel') q.wheel++;
  if (ev.game === 'slots') q.slots++;
  q.wager += ev.wager;
  if (ev.wager > 0 || ev.daily) { const n = S.stats.opens + 1; un('first_open'); un('opens_10', n >= 10); un('opens_100', n >= 100); un('opens_1000', n >= 1000); }
  const r = ev.rank ?? -1; un('epic', r >= 2); un('legend', r >= 3); un('mythic', r >= 4); un('nft', !!ev.nft);
  un('wheel_x10', ev.game === 'wheel' && (ev.mult ?? 0) >= 10); un('slots_jackpot', ev.game === 'slots' && ev.outcome === 'g3');
  for (const a of ev.unlock ?? []) un(a);
  const from = levelInfo(m.xp).level;
  m.xp += ev.wager + (ev.daily ? 5 : 0) + (ev.bonusXp ?? 0) + unlocked.reduce((s2, id) => s2 + (ACHIEVEMENTS.find((a) => a.id === id)?.xp ?? 0), 0);
  let to = levelInfo(m.xp).level;
  if (to >= 10) { un('level_10'); }
  to = levelInfo(m.xp).level;
  let bonus = 0; for (let l = from + 1; l <= to; l++) bonus += levelReward(l);
  m.ach = [...has];
  const lv = levelInfo(m.xp);
  return { delta: { xp: m.xp, level: lv.level, into: lv.into, need: lv.need, levelUp: to > from ? to : 0, levelBonus: bonus, quests: { ...q } }, unlocked, bonus };
}
const save = () => { try { localStorage.setItem(LS, JSON.stringify(S)); } catch { /* private mode */ } };
const sync = () => {
  if (!store.progress.get()) setProgress(mockProgressInfo());
  store.balance.set(S.balance);
  store.inventory.set([...S.inv]);
  store.stats.set({ ...S.stats });
  save();
};

async function sha256(s: string) {
  if (!crypto.subtle) return rnd(32); // insecure context (plain http in LAN dev) — cosmetic only
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
}
/** float in [0,1) from sha256(serverSeed:clientSeed:nonce) — server will use HMAC-SHA256. */
async function roll(f: Fairness, serverSeed: string) {
  const hex = await sha256(`${serverSeed}:${f.clientSeed}:${f.nonce}`);
  return parseInt(hex.slice(0, 13), 16) / 2 ** 52;
}
function pick(caseId: string, r: number): Prize {
  const c = caseById(caseId)!;
  const total = c.drops.reduce((s, d) => s + d.weight, 0);
  let x = r * total;
  for (const d of c.drops) { x -= d.weight; if (x < 0) return PRIZES[d.prize]; }
  return PRIZES[c.drops[c.drops.length - 1].prize];
}

const qs = new URLSearchParams(location.search);
/** QA helper (?force=diamond) — mock only, never exists server-side. */
const forced = qs.get('force');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockApi: GameApi = {
  async bootstrap() { sync(); return { balance: S.balance }; },
  async nextRoundHash() { return { serverSeedHash: await sha256(S.serverSeed), clientSeed: S.clientSeed, nonce: S.nonce + 1 }; },

  async openCase(caseId, { demo }) {
    const c = caseById(caseId);
    if (!c) throw new ApiError('NOT_FOUND');
    await wait(120 + Math.random() * 120); // network-ish latency so the UI is built for it
    if (!demo) {
      if (c.price === 0) {
        if (store.dailyReadyAt.get() > Date.now()) throw new ApiError('DAILY_COOLDOWN');
      } else if (S.balance < c.price) throw new ApiError('NO_BALANCE');
    }
    const serverSeed = S.serverSeed;
    const fairness: Fairness = { serverSeedHash: await sha256(serverSeed), clientSeed: S.clientSeed, nonce: ++S.nonce };
    let prize = pick(caseId, await roll(fairness, serverSeed));
    if (forced && PRIZES[forced]) prize = PRIZES[forced];
    // rotate seed after each round and reveal the used one
    fairness.serverSeed = serverSeed; S.serverSeed = rnd(32);

    const res: OpenResult = { roundId: rnd(8), caseId, demo, prize, balance: S.balance, fairness };
    if (!demo) {
      if (c.price === 0) { const at = Date.now() + DAY; localStorage.setItem('gg.dailyAt', String(at)); store.dailyReadyAt.set(at); }
      S.balance -= c.price;
      S.stats.opens++;
      if (prize.value >= c.price) S.stats.wins++;
      if (c.price) S.stats.best = Math.max(S.stats.best, +(prize.value / c.price).toFixed(1));
      const pr = mockProgress({ wager: c.price, game: 'case', daily: c.price === 0, rank: RARITY_RANK[prize.rarity], nft: prize.kind === 'nft' });
      S.balance += pr.bonus; res.progress = pr.delta; res.unlocked = pr.unlocked;
      applyProgress(pr.delta, pr.unlocked, true);
      if (prize.kind === 'stars') { S.balance += prize.value; res.credited = prize.value; }
      else { const it: InvItem = { uid: rnd(6), prizeId: prize.id, caseId, wonAt: Date.now(), status: 'owned' }; S.inv.unshift(it); res.itemUid = it.uid; }
      res.balance = S.balance;
    }
    // balance is synced by the caller after the animation (so the header doesn't spoil the result)
    save();
    return res;
  },

  commit() { sync(); flushCelebrations(); },

  async sell(uid) {
    const i = S.inv.findIndex((x) => x.uid === uid && x.status === 'owned');
    if (i < 0) throw new ApiError('NOT_FOUND');
    const value = S.inv[i].value ?? PRIZES[S.inv[i].prizeId].value;
    S.inv.splice(i, 1); S.balance += value; sync();
    return { balance: S.balance, credited: value };
  },
  async withdraw(uid) {
    // TODO(server): queue → anticheat checks → bot sendGift / giftPremiumSubscription → status updates via bot DM
    const it = S.inv.find((x) => x.uid === uid && x.status === 'owned');
    if (!it) throw new ApiError('NOT_FOUND');
    it.status = 'withdrawing'; sync();
    return PRIZES[it.prizeId]?.kind === 'nft' ? { status: 'queued' as const, manual: true } : { status: 'queued' as const };
  },
  async buyPremium(months) {
    const tier = PREMIUM_TIERS.find((x) => x.months === months)!;
    if (S.balance < tier.price) throw new ApiError('NO_BALANCE');
    S.balance -= tier.price; sync();
    return { status: 'queued' as const, balance: S.balance };
  },
  async topUp(stars) {
    // demo only: no real payment in mock mode
    if (!Number.isInteger(stars) || stars < 1) throw new ApiError('NOT_FOUND');
    S.balance += stars; sync();
    return { status: 'paid' as const, balance: S.balance };
  },
  inventory: () => [...S.inv],
  cases: () => CASES,

  async progress() { const p = mockProgressInfo(); setProgress(p); return p; },
  async spin(game, bet) {
    await wait(140 + Math.random() * 120);
    if (!(GAME_BETS as readonly number[]).includes(bet)) throw new ApiError('NOT_FOUND');
    if (S.balance < bet) throw new ApiError('NO_BALANCE');
    const serverSeed = S.serverSeed;
    const fairness: Fairness = { serverSeedHash: await sha256(serverSeed), clientSeed: S.clientSeed, nonce: ++S.nonce };
    const r = await roll(fairness, serverSeed);
    const f = qs.get('force');
    let mult = 0, outcome = '', index: number | undefined, faces: SpinResult['faces'];
    if (game === 'wheel') {
      index = f && /^w\d+$/.test(f) ? Number(f.slice(1)) : wheelPick(r); mult = WHEEL[index].m; outcome = `w${index}`;
    } else {
      const forcedO = f ? (await import('./games')).SLOTS.find((o) => o.id === f) : undefined;
      const o = forcedO ?? slotsPick(r); mult = o.m; outcome = o.id; faces = slotsFaces(o, Math.random());
    }
    fairness.serverSeed = serverSeed; S.serverSeed = rnd(32);
    const payout = Math.round(bet * mult);
    const pr = mockProgress({ wager: bet, game, mult, outcome, rank: payout > bet ? (mult >= 20 ? 4 : mult >= 10 ? 3 : mult >= 3 ? 2 : 1) : -1 });
    S.balance += payout - bet + pr.bonus;
    S.stats.opens++; if (payout >= bet) S.stats.wins++; S.stats.best = Math.max(S.stats.best, mult);
    applyProgress(pr.delta, pr.unlocked, true);
    save();
    return { roundId: rnd(8), game, bet, mult, payout, outcome, index, faces, balance: S.balance, fairness, progress: pr.delta, unlocked: pr.unlocked };
  },
  async luckDraw() {
    await wait(300);
    const m = M(); const day = kyivDay();
    if (m.luckDay === day && !qs.has('luckagain')) throw new ApiError('DAILY_COOLDOWN');
    const pct = luckPick(Math.random());
    m.luckDay = day; m.luckPct = pct; m.luckUntil = Date.now() + 24 * 3600_000; save();
    patchProgress((p) => ({ ...p, luck: { pct, until: m.luckUntil, drawnToday: true } }));
    return { pct, active: pct, until: m.luckUntil };
  },
  async streakClaim() {
    await wait(200);
    const m = M(); const day = kyivDay();
    if (m.streakDay === day) throw new ApiError('DAILY_COOLDOWN');
    const count = m.streakDay === kyivDay(Date.now() - 86400_000) ? m.streakCount + 1 : 1;
    const reward = streakReward(count);
    m.streakDay = day; m.streakCount = count;
    const pr = mockProgress({ wager: 0, game: 'case', unlock: count >= 7 ? ['streak_7'] : [] });
    S.balance += reward + pr.bonus; sync();
    patchProgress((p) => ({ ...p, streak: { count, claimedToday: true } }));
    applyProgress(pr.delta, pr.unlocked);
    return { count, reward, balance: S.balance, unlocked: pr.unlocked, progress: pr.delta };
  },
  async questClaim(id) {
    await wait(200);
    const def = QUESTS.find((q) => q.id === id); if (!def) throw new ApiError('NOT_FOUND');
    const q = questsNow();
    if (q.claimed.includes(def.id)) throw new ApiError('DAILY_COOLDOWN');
    if (questProgress(q, def) < def.goal) throw new ApiError('NOT_FOUND');
    q.claimed.push(def.id);
    const pr = mockProgress({ wager: 0, game: 'case', bonusXp: def.xp });
    S.balance += def.stars + pr.bonus; sync();
    applyProgress(pr.delta, pr.unlocked);
    return { id: def.id, stars: def.stars, xp: def.xp, balance: S.balance, unlocked: pr.unlocked, progress: pr.delta };
  },
  async saveSettings(st) {
    const m = M(); if (typeof st.hideFeed === 'boolean') m.hideFeed = st.hideFeed; if (typeof st.notify === 'boolean') m.notify = st.notify; save();
    patchProgress((p) => ({ ...p, settings: { hideFeed: m.hideFeed, notify: m.notify } }));
    return { hideFeed: m.hideFeed, notify: m.notify, botStarted: true };
  },
  async feed() { return null; },
  async leaderboard() {
    const names = ['Настя', 'maks_k', 'Дима', 'Kate', 'Артём', null, 'lera_mur', 'Богдан', 'Mira', 'vlad_off', 'Оля', 'den4ik'];
    const top = names.map((name, i) => ({ rank: i + 1, name, level: Math.max(2, 24 - i * 2), score: Math.round(42000 / (i + 1.4)) }));
    const meScore = M().xp % 5000 + 900;
    const rank = top.filter((x) => x.score > meScore).length + 1;
    const rows = [...top.slice(0, rank - 1), { rank, name: store.progress.get() ? 'Алекс' : 'Алекс', level: levelInfo(M().xp).level, score: meScore, me: true }, ...top.slice(rank - 1).map((x) => ({ ...x, rank: x.rank + 1 }))].slice(0, 12);
    return { week: '2026-W47', top: rows, me: { rank, score: meScore, level: levelInfo(M().xp).level } };
  },
  async sellMany(uids) {
    const set = new Set(uids); let total = 0;
    for (const it of S.inv) if (set.has(it.uid)) { if (it.status !== 'owned') throw new ApiError('NOT_FOUND'); total += it.value ?? PRIZES[it.prizeId].value; }
    S.inv = S.inv.filter((x) => !set.has(x.uid)); S.balance += total; sync();
    return { balance: S.balance, credited: total };
  },
};
