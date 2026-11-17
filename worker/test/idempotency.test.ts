import { expect, test } from 'vitest';
import { USER, call, makeApp, pay } from './helpers.ts';

test('same idempotency key does not charge twice and returns the same prize', async () => {
  const { handle, db } = makeApp();

  const boot = await call(handle, '/v1/bootstrap', {});
  expect(boot.status).toBe(200);

  const credited = await pay(handle, 'ch_1', 1000);
  expect(credited.status).toBe(200);
  expect((credited.body as { balance: number }).balance).toBe(1000);

  const key = 'open-key-1';
  const a = await call(handle, '/v1/open', { caseId: 'neon', demo: false }, { 'x-idempotency-key': key });
  expect(a.status, JSON.stringify(a.body)).toBe(200);
  const first = a.body as { roundId: string; balance: number; prize: { id: string }; fairness: { serverSeed: string } };
  expect(first.roundId).toBeTruthy();
  expect(first.balance).not.toBe(1000);

  const b = await call(handle, '/v1/open', { caseId: 'neon', demo: false }, { 'x-idempotency-key': key });
  expect(b.status).toBe(200);
  const second = b.body as { roundId: string; balance: number; prize: { id: string } };
  expect(second.roundId).toBe(first.roundId);
  expect(second.balance).toBe(first.balance);
  expect(second.prize.id).toBe(first.prize.id);

  const rows = await db.prepare('SELECT COUNT(*) AS n FROM fairness_log WHERE user_id = ?').bind(USER).first<{ n: number }>();
  expect(rows!.n).toBe(1);
  const ledger = await db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND type = 'case_open'").bind(USER).first<{ n: number }>();
  expect(ledger!.n).toBe(1);
});
