import { CASES, PRIZES, PREMIUM_TIERS, caseById } from './catalog';
import type { GameApi } from './index';
import { ApiError } from './types';
import type { Fairness, InvItem, OpenResult, Prize } from './types';
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
const DAY = 24 * 60 * 60 * 1000;

interface State { balance: number; inv: InvItem[]; nonce: number; clientSeed: string; serverSeed: string; stats: { opens: number; wins: number; best: number } }

const rnd = (n = 16) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
const load = (): State => {
  try { const s = JSON.parse(localStorage.getItem(LS) || ''); if (s && typeof s.balance === 'number') return s; } catch { /* fresh */ }
  return { balance: 1250, inv: [], nonce: 0, clientSeed: rnd(8), serverSeed: rnd(32), stats: { opens: 0, wins: 0, best: 0 } };
};
let S = load();
const save = () => { try { localStorage.setItem(LS, JSON.stringify(S)); } catch { /* private mode */ } };
const sync = () => {
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
      if (prize.kind === 'stars') { S.balance += prize.value; res.credited = prize.value; }
      else { const it: InvItem = { uid: rnd(6), prizeId: prize.id, caseId, wonAt: Date.now(), status: 'owned' }; S.inv.unshift(it); res.itemUid = it.uid; }
      res.balance = S.balance;
    }
    // balance is synced by the caller after the animation (so the header doesn't spoil the result)
    save();
    return res;
  },

  commit() { sync(); },

  async sell(uid) {
    const i = S.inv.findIndex((x) => x.uid === uid && x.status === 'owned');
    if (i < 0) throw new ApiError('NOT_FOUND');
    const value = PRIZES[S.inv[i].prizeId].value;
    S.inv.splice(i, 1); S.balance += value; sync();
    return { balance: S.balance, credited: value };
  },
  async withdraw(uid) {
    // TODO(server): queue → anticheat checks → bot sendGift / giftPremiumSubscription → status updates via bot DM
    const it = S.inv.find((x) => x.uid === uid && x.status === 'owned');
    if (!it) throw new ApiError('NOT_FOUND');
    it.status = 'withdrawing'; sync();
    return { status: 'queued' as const };
  },
  async buyPremium(months) {
    const tier = PREMIUM_TIERS.find((x) => x.months === months)!;
    if (S.balance < tier.price) throw new ApiError('NO_BALANCE');
    S.balance -= tier.price; sync();
    return { status: 'queued' as const, balance: S.balance };
  },
  inventory: () => [...S.inv],
  cases: () => CASES,
};
