import type { GameApi } from './index';
import { ApiError } from './types';
import type { Fairness, InvItem, OpenResult } from './types';
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
  if (C.dailyReadyAt) store.dailyReadyAt.set(C.dailyReadyAt);
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
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data: { error?: string } & T;
  try { data = await res.json(); } catch { throw new ApiError('BUSY'); }
  if (!res.ok) {
    const code = data.error;
    if (code === 'NO_BALANCE' || code === 'DAILY_COOLDOWN' || code === 'NOT_FOUND' || code === 'BUSY') throw new ApiError(code);
    throw new ApiError('BUSY');
  }
  return data;
}

const newKey = () => crypto.randomUUID();

export const httpApi: GameApi = {
  async bootstrap() {
    const r = await req<{ balance: number; inventory: InvItem[]; dailyReadyAt?: number }>('/v1/bootstrap', { method: 'POST', body: {} });
    C.balance = r.balance;
    C.inv = r.inventory || [];
    C.dailyReadyAt = r.dailyReadyAt || 0;
    sync();
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
        C.inv = [{ uid: r.itemUid, prizeId: r.prize.id, caseId, wonAt: Date.now(), status: 'owned' }, ...C.inv];
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
    const r = await req<{ status: 'queued' }>('/v1/withdraw', { body: { uid }, key: newKey() });
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
  inventory: () => [...C.inv],
  cases: () => CASES,
};
