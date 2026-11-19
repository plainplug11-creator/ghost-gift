import type { GameApi } from './index';
import { ApiError } from './types';
import type { CaseDrop, Fairness, FeedItem, FeedStats, InvItem, Leaderboard, OpenResult, ProgressInfo, SpinResult } from './types';
import { applyProgress, flushCelebrations, patchProgress, setProgress } from '../core/progress';
import { CASES } from './catalog';
import { store } from '../core/store';

/**
 * Production API client. Used only when VITE_API_URL is set; otherwise the
 * app keeps talking to mockApi and behaves exactly as before.
 */
const BASE = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

interface Cache { balance: number; inv: InvItem[]; dailyReadyAt: number }
const C: Cache = { balance: 0, inv: [], dailyReadyAt: 0 };

const sync = () => {
  store.balance.set(C.balance);
  store.inventory.set([...C.inv]);
  store.dailyReadyAt.set(C.dailyReadyAt); // server is the source of truth (0 = ready)
};

const initData = () => {
  const w = window as unknown as { Telegram?: { WebApp?: { initData?: string } } };
  return w.Telegram?.WebApp?.initData || '';
};

const deviceId = () => {
  const k = 'gg.device';
  try {
    let id = localStorage.getItem(k);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(k, id); }
    return id;
  } catch { return 'anon'; }
};

async function req<T>(path: string, opts: { method?: string; body?: unknown; key?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `tma ${initData()}`,
    'X-Device-Id': deviceId(),
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.key) headers['X-Idempotency-Key'] = opts.key;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError('OFFLINE'); // network down, DNS, CORS or timeout
  } finally {
    clearTimeout(timer);
  }
  let data: { error?: string } & T;
  try { data = await res.json(); } catch { throw new ApiError(res.status >= 500 || res.status === 0 ? 'OFFLINE' : 'BUSY'); }
  if (!res.ok) {
    const code = data.error;
    if (res.status === 401 || code === 'UNAUTHORIZED' || code === 'STALE_AUTH') throw new ApiError('AUTH');
    if (code === 'NO_BALANCE' || code === 'DAILY_COOLDOWN' || code === 'NOT_FOUND' || code === 'BUSY' || code === 'NFT_PENDING' || code === 'LIMIT') throw new ApiError(code);
    throw new ApiError('BUSY');
  }
  return data;
}

const TIMEOUT_MS = 12_000;
let pendingStats: { opens: number; wins: number; best: number } | null = null;
function bumpStats(value: number, caseId: string) {
  const price = CASES.find((c) => c.id === caseId)?.price ?? 0;
  const st = store.stats.get();
  pendingStats = { opens: st.opens + 1, wins: st.wins + (value >= price ? 1 : 0), best: price ? Math.max(st.best, +(value / price).toFixed(1)) : st.best };
}
const newKey = () => crypto.randomUUID();

/** One bootstrap at a time; progress() calls made meanwhile reuse its payload instead of a second request. */
let booting: Promise<{ balance: number }> | null = null;
let progressInFlight: Promise<ProgressInfo> | null = null;
async function bootOnce(): Promise<{ balance: number }> {
  const ref = startParam();
  const r = await req<{ balance: number; inventory: InvItem[]; dailyReadyAt?: number; progress?: ProgressInfo; stats?: { opens: number; wins: number; best: number } }>('/v1/bootstrap', { method: 'POST', body: ref ? { ref } : {} });
  C.balance = r.balance;
  C.inv = r.inventory || [];
  C.dailyReadyAt = r.dailyReadyAt || 0;
  sync();
  if (r.stats) store.stats.set(r.stats);
  if (r.progress) setProgress(r.progress);
  void syncCases();
  if (!r.progress) void httpApi.progress().catch(() => {});
  return { balance: C.balance };
}

export const httpApi: GameApi = {
  bootstrap() {
    return (booting ??= bootOnce().finally(() => { booting = null; }));
  },
  async nextRoundHash() {
    return req<Pick<Fairness, 'serverSeedHash' | 'clientSeed' | 'nonce'>>('/v1/next-round');
  },
  async openCase(caseId, { demo }) {
    const r = await req<OpenResult & { dailyReadyAt?: number }>('/v1/open', { body: { caseId, demo }, key: newKey() });
    if (!demo) {
      C.balance = r.balance;
      if (r.dailyReadyAt) C.dailyReadyAt = r.dailyReadyAt;
      if (r.itemUid) {
        C.inv = [{ uid: r.itemUid, prizeId: r.prize.id, caseId, wonAt: Date.now(), status: 'owned', ...(r.prize.nft ? { value: r.prize.value, nft: r.prize.nft } : {}) }, ...C.inv];
      }
    }
    if (!demo) { applyProgress(r.progress, r.unlocked, true); bumpStats(r.prize.value, caseId); }
    // store is synced by commit() after the reveal animation
    return r;
  },
  commit() { sync(); if (pendingStats) { store.stats.set(pendingStats); pendingStats = null; } flushCelebrations(); },
  async sell(uid) {
    const r = await req<{ balance: number; credited: number }>('/v1/sell', { body: { uid }, key: newKey() });
    C.inv = C.inv.filter((x) => x.uid !== uid);
    C.balance = r.balance;
    sync();
    return r;
  },
  async withdraw(uid) {
    const r = await req<{ status: 'queued'; review?: boolean; manual?: boolean }>('/v1/withdraw', { body: { uid }, key: newKey() });
    const it = C.inv.find((x) => x.uid === uid);
    if (it) it.status = 'withdrawing';
    sync();
    return r;
  },
  async buyPremium(months) {
    const r = await req<{ status: 'queued'; balance: number }>('/v1/buy-premium', { body: { months }, key: newKey() });
    C.balance = r.balance;
    sync();
    return r;
  },
  async topUp(stars) {
    const inv = await req<{ invoiceId: string; link: string }>('/v1/topup', { body: { stars } });
    const tg = (window as unknown as { Telegram?: { WebApp?: { openInvoice?: (url: string, cb: (s: string) => void) => void } } }).Telegram?.WebApp;
    if (!tg?.openInvoice) { window.open(inv.link, '_blank'); return { status: 'pending' as const, balance: C.balance }; }
    const closed = await new Promise<string>((resolve) => tg.openInvoice!(inv.link, resolve));
    if (closed === 'cancelled') return { status: 'cancelled' as const, balance: C.balance };
    if (closed === 'failed') return { status: 'failed' as const, balance: C.balance };
    // 'paid' (or 'pending'): the webhook credits the balance; poll briefly
    for (let i = 0; i < 12; i++) {
      try {
        const s = await req<{ status: string; balance: number }>(`/v1/invoice?id=${encodeURIComponent(inv.invoiceId)}`);
        if (s.status === 'paid') { C.balance = s.balance; sync(); return { status: 'paid' as const, balance: C.balance }; }
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, i < 4 ? 700 : 1500));
    }
    return { status: 'pending' as const, balance: C.balance };
  },
  inventory: () => [...C.inv],
  cases: () => CASES,

  async progress() {
    if (booting) { await booting.catch(() => {}); const cur = store.progress.get(); if (cur) return cur; }
    return (progressInFlight ??= req<ProgressInfo>('/v1/progress').then((p) => { setProgress(p); return p; }).finally(() => { progressInFlight = null; }));
  },
  async spin(game, bet) {
    const r = await req<SpinResult>(`/v1/${game}`, { body: { bet }, key: newKey() });
    C.balance = r.balance; // the header syncs in commit() after the animation
    const st = store.stats.get();
    pendingStats = { opens: st.opens + 1, wins: st.wins + (r.payout >= r.bet ? 1 : 0), best: Math.max(st.best, r.mult) };
    applyProgress(r.progress, r.unlocked, true);
    patchProgress((p) => ({ ...p }));
    return r;
  },
  async luckDraw() {
    const r = await req<{ pct: number; active: number; until: number }>('/v1/luck/draw', { body: {}, key: newKey() });
    patchProgress((p) => ({ ...p, luck: { pct: r.active, until: r.until, drawnToday: true } }));
    return r;
  },
  async streakClaim() {
    const r = await req<{ count: number; reward: number; balance: number; unlocked?: []; progress?: never }>('/v1/streak/claim', { body: {}, key: newKey() });
    C.balance = r.balance; sync();
    patchProgress((p) => ({ ...p, streak: { count: r.count, claimedToday: true } }));
    applyProgress(r.progress, r.unlocked);
    return r;
  },
  async questClaim(id) {
    const r = await req<{ id: typeof id; stars: number; xp: number; balance: number }>('/v1/quests/claim', { body: { id }, key: newKey() });
    C.balance = r.balance; sync();
    applyProgress((r as never as { progress?: never }).progress, (r as { unlocked?: never }).unlocked);
    return r;
  },
  async saveSettings(s) {
    const r = await req<{ hideFeed: boolean; notify: boolean; botStarted?: boolean }>('/v1/settings', { body: s });
    patchProgress((p) => ({ ...p, settings: { hideFeed: r.hideFeed, notify: r.notify } }));
    return r;
  },
  async feed() {
    const r = await req<{ feed: FeedItem[]; stats?: FeedStats }>('/v1/feed');
    return { items: r.feed, stats: r.stats };
  },
  async leaderboard() {
    return req<Leaderboard>('/v1/leaderboard');
  },
  async sellMany(uids) {
    const r = await req<{ balance: number; credited: number }>('/v1/sell-many', { body: { uids }, key: newKey() });
    const set = new Set(uids);
    C.inv = C.inv.filter((x) => !set.has(x.uid));
    C.balance = r.balance;
    sync();
    return r;
  },
};

/** Referral code from the Mini App start parameter (t.me/<bot>/<app>?startapp=ref_123). */
function startParam(): string {
  const w = window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { start_param?: string } } } };
  const sp = w.Telegram?.WebApp?.initDataUnsafe?.start_param || '';
  return /^ref_\d{3,15}$/.test(sp) ? sp : '';
}

/** Live odds from the server (NFT tiers appear only while in stock); updates CASES in place. */
async function syncCases() {
  try {
    const r = await req<{ cases: { id: string; drops: CaseDrop[] }[] }>('/v1/cases');
    for (const live of r.cases || []) {
      const c = CASES.find((x) => x.id === live.id);
      if (c && Array.isArray(live.drops) && live.drops.length) c.drops = live.drops;
    }
  } catch { /* keep bundled odds */ }
}
