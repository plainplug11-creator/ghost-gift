import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import { hitBurstLimit } from '../src/risk.ts';

const db = (env as unknown as { DB: D1Database }).DB;

test('burst bucket: allows a burst, throttles, refills at the sustained rate', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const t0 = new Date('2026-11-19T12:00:00Z').getTime();
  vi.setSystemTime(t0);
  const key = 'apib:test-' + Math.random();
  const res: boolean[] = [];
  for (let i = 0; i < 12; i++) res.push(await hitBurstLimit(db, key, 60, 10));
  expect(res.slice(0, 10).every((x) => !x)).toBe(true); // 10 back-to-back OK
  expect(res[10]).toBe(true); // 11th throttled
  // hammering keeps it throttled (debt is capped at one token, never refills while spamming)
  expect(await hitBurstLimit(db, key, 60, 10)).toBe(true);
  vi.setSystemTime(t0 + 2500); // 60/min = 1 token/s -> 2.5 tokens, minus <=1 debt
  expect(await hitBurstLimit(db, key, 60, 10)).toBe(false);
  vi.setSystemTime(t0 + 60_000); // a minute later the full burst is back
  const again: boolean[] = [];
  for (let i = 0; i < 10; i++) again.push(await hitBurstLimit(db, key, 60, 10));
  expect(again.every((x) => !x)).toBe(true);
  vi.useRealTimers();
});
