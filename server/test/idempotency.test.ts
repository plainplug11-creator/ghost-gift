import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, type AppReq } from '../src/app.ts';
import { signInitData } from '../src/auth.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db.ts';

const TOKEN = 'idem-test-token';
const USER = '1001';

function initData() {
  return signInitData({
    user: JSON.stringify({ id: Number(USER), first_name: 'T' }),
    auth_date: String(Math.floor(Date.now() / 1000)),
  }, TOKEN);
}

async function call(handle: (r: AppReq) => Promise<{ status: number; body: unknown }>, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await handle({
    method: body === undefined && !path.includes('bootstrap') && !path.includes('webhook') && !path.includes('open') && !path.includes('sell') ? 'GET' : 'POST',
    url: path,
    headers: {
      authorization: `tma ${initData()}`,
      'content-type': 'application/json',
      'x-device-id': 'dev-1',
      ...extra,
    },
    body: body === undefined ? '' : JSON.stringify(body),
    ip: '203.0.113.10',
  });
  return res;
}

test('same idempotency key does not charge twice and returns the same prize', async () => {
  const db = openDb(':memory:');
  const cfg = loadConfig({ botToken: TOKEN, databasePath: ':memory:', bankStart: 50_000, bankReserve: 0, dailyBigPrizeCap: 100 });
  const { handle } = createApp(db, cfg);

  const boot = await call(handle, '/v1/bootstrap', {});
  assert.equal(boot.status, 200);

  const credited = await handle({
    method: 'POST',
    url: '/v1/webhook/telegram',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        from: { id: Number(USER) },
        successful_payment: { telegram_payment_charge_id: 'ch_1', total_amount: 1000, currency: 'XTR', invoice_payload: USER },
      },
    }),
    ip: '127.0.0.1',
  });
  assert.equal(credited.status, 200);
  assert.equal((credited.body as { balance: number }).balance, 1000);

  const key = 'open-key-1';
  const a = await call(handle, '/v1/open', { caseId: 'neon', demo: false }, { 'x-idempotency-key': key });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const first = a.body as { roundId: string; balance: number; prize: { id: string }; fairness: { serverSeed: string } };
  assert.ok(first.roundId);
  assert.notEqual(first.balance, 1000);

  const b = await call(handle, '/v1/open', { caseId: 'neon', demo: false }, { 'x-idempotency-key': key });
  assert.equal(b.status, 200);
  const second = b.body as { roundId: string; balance: number; prize: { id: string } };
  assert.equal(second.roundId, first.roundId);
  assert.equal(second.balance, first.balance);
  assert.equal(second.prize.id, first.prize.id);

  const rows = db.prepare('SELECT COUNT(*) AS n FROM fairness_log WHERE user_id = ?').get(USER) as { n: number };
  assert.equal(rows.n, 1);

  const ledger = db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND type = 'case_open'").get(USER) as { n: number };
  assert.equal(ledger.n, 1);
});
