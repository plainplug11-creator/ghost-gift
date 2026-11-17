import type { GameApi } from './index';
import { ApiError } from './types';
import type { CaseDrop, Fairness, InvItem, OpenResult } from './types';
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
    if (code === 'NO_BALANCE' || code === 'DAILY_COOLDOWN' || code === 'NOT_FOUND' || code === 'BUSY' || code === 'NFT_PENDING') throw new ApiError(code);
    throw new ApiError('BUSY');
  }
  return data;
}

const TIMEOUT_MS = 12_000;
const newKey = () => crypto.randomUUID();

export const httpApi: GameApi = {
  async bootstrap() {
    const r = await req<{ balance: number; inventory: InvItem[]; dailyReadyAt?: number }>('/v1/bootstrap', { method: 'POST', body: {} });
    C.balance = r.balance;
    C.inv = r.inventory || [];
    C.dailyReadyAt = r.dailyReadyAt || 0;
    sync();
    void syncCases();
    return { balance: C.balance };
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
    // store is synced by commit() after the reveal animation
    return r;
  },
  commit() { sync(); },
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
};

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
