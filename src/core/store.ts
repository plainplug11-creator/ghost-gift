/**
 * Client-side UI state ONLY. In production every number here (balance,
 * daily-claim time, inventory, stats) comes from the server — the client never
 * decides outcomes or balances (anti-cheat rule #1). These are display mirrors.
 */
import type { InvItem, Prize } from '../api/types';

type Fn = () => void;

function signal<T>(initial: T) {
  let v = initial;
  const subs = new Set<Fn>();
  return {
    get: () => v,
    set: (n: T) => { if (n !== v) { v = n; subs.forEach((s) => s()); } },
    sub: (s: Fn) => { subs.add(s); return () => subs.delete(s); },
  };
}

const qs = new URLSearchParams(location.search);

export const store = {
  // server mode: show 0 until /v1/bootstrap returns the real balance (mock keeps its demo 1250)
  balance: signal(import.meta.env.VITE_API_URL ? 0 : 1250),
  /** Timestamp when the next free daily case becomes available. */
  dailyReadyAt: signal(
    qs.has('daily') ? Date.now() + Number(qs.get('daily')) * 1000 : Number(localStorage.getItem('gg.dailyAt') || 0),
  ),
  /** Win streak — header ghost glows brighter at >= 3. */
  streak: signal(0),
  inventory: signal<InvItem[]>([]),
  stats: signal({ opens: 0, wins: 0, best: 0 }),
  /** Last real (non-demo) win of THIS user → pushed into the live feed. */
  lastWin: signal<Prize | null>(null),
  /** Sound effects (muted by default). */
  sound: signal(false),
};
