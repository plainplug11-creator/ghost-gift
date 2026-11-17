// Extra D1-specific checks (not in the Node suite): concurrency, refunds, review queue, CORS, HTTP entry.
import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { Tx, isConflict } from '../src/db.ts';
import { seedHash, fairRoll } from '../src/fair.ts';
import { call, makeApp, pay } from './helpers.ts';

test('concurrent opens with one key charge once; concurrent different keys never overspend', async () => {
  const { handle, db } = makeApp();
  const U = '2002';
  await call(handle, '/v1/bootstrap', {}, {}, U);
  await pay(handle, 'ch_c1', 300, U);
  const same = await Promise.all([1, 2, 3].map(() => call(handle, '/v1/open', { caseId: 'neon', demo: false }, { 'x-idempotency-key': 'k-same' }, U)));
  const ids = new Set(same.map((r) => (r.body as { roundId: string }).roundId));
  expect(same.every((r) => r.status === 200)).toBe(true);
  expect(ids.size).toBe(1);
  const n = await db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND type = 'case_open'").bind(U).first<{ n: number }>();
  expect(n!.n).toBe(1);

  await Promise.all([1, 2, 3, 4, 5].map((i) => call(handle, '/v1/open', { caseId: 'neon', demo: false }, { 'x-idempotency-key': `k-${i}` }, U)));
  const u = await db.prepare('SELECT balance, nonce FROM users WHERE id = ?').bind(U).first<{ balance: number; nonce: number }>();
  const sum = await db.prepare('SELECT SUM(amount) AS s FROM ledger WHERE user_id = ?').bind(U).first<{ s: number }>();
  expect(u!.balance).toBe(sum!.s); // ledger always reconciles with balance
  expect(u!.balance).toBeGreaterThanOrEqual(0);
  const logs = await db.prepare('SELECT COUNT(*) AS n FROM fairness_log WHERE user_id = ?').bind(U).first<{ n: number }>();
  expect(logs!.n).toBe(u!.nonce);
});

test('revealed seed verifies against the committed hash', async () => {
  const { handle } = makeApp();
  const U = '3003';
  const boot = await call(handle, '/v1/bootstrap', {}, {}, U);
  const committed = (boot.body as { fairness: { serverSeedHash: string; nonce: number } }).fairness;
  const r = await call(handle, '/v1/open', { caseId: 'daily', demo: false }, {}, U);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const f = (r.body as { fairness: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number } }).fairness;
  expect(f.serverSeedHash).toBe(committed.serverSeedHash);
  expect(await seedHash(f.serverSeed)).toBe(committed.serverSeedHash);
  expect(f.nonce).toBe(committed.nonce);
  expect(typeof (await fairRoll(f.serverSeed, f.clientSeed, f.nonce))).toBe('number');
});

test('duplicate payment is ignored, refund debits and flags', async () => {
  const { handle, db } = makeApp();
  const U = '4004';
  expect(((await pay(handle, 'ch_r', 500, U)).body as { status: string }).status).toBe('credited');
  expect(((await pay(handle, 'ch_r', 500, U)).body as { status: string }).status).toBe('duplicate');
  const refund = { message: { refunded_payment: { telegram_payment_charge_id: 'ch_r', total_amount: 500 } } };
  const req = { method: 'POST', url: '/v1/webhook/telegram', headers: {}, ip: '', body: JSON.stringify(refund) };
  const r1 = await handle(req);
  expect(r1.body).toMatchObject({ status: 'refunded', balance: 0, flagged: true });
  expect((await handle(req)).body).toMatchObject({ status: 'already_refunded' });
  const u = await db.prepare('SELECT flagged, risk_score FROM users WHERE id = ?').bind(U).first<{ flagged: number; risk_score: number }>();
  expect(u).toMatchObject({ flagged: 1, risk_score: 30 });
});

test('webhook secret is enforced when set', async () => {
  const { handle } = makeApp({ webhookSecret: 's3cret' });
  const body = JSON.stringify({ message: { successful_payment: { telegram_payment_charge_id: 'x', total_amount: 1, invoice_payload: '5' } } });
  expect((await handle({ method: 'POST', url: '/v1/webhook/telegram', headers: {}, ip: '', body })).status).toBe(401);
  expect((await handle({ method: 'POST', url: '/v1/webhook/telegram', headers: { 'X-Telegram-Bot-Api-Secret-Token': 's3cret' }, ip: '', body })).status).toBe(200);
});

test('withdrawals from new accounts go to review; item cannot be sold twice', async () => {
  const { handle, db } = makeApp();
  const U = '5005';
  await call(handle, '/v1/bootstrap', {}, {}, U);
  const now = Date.now();
  await db.prepare("INSERT INTO inventory (uid, user_id, prize_id, case_id, won_at, status) VALUES ('itemA', ?, ?, 'neon', ?, 'owned')").bind(U, await anyItemPrize(), now).run();
  await db.prepare("INSERT INTO inventory (uid, user_id, prize_id, case_id, won_at, status) VALUES ('itemB', ?, ?, 'neon', ?, 'owned')").bind(U, await anyItemPrize(), now).run();
  const w = await call(handle, '/v1/withdraw', { uid: 'itemA' }, {}, U);
  expect(w.body).toMatchObject({ status: 'queued', review: true });
  const q = await db.prepare("SELECT status, reason FROM withdrawals WHERE item_uid = 'itemA'").first<{ status: string; reason: string }>();
  expect(q!.status).toBe('review');
  expect(q!.reason).toContain('new_account');
  const sells = await Promise.all([1, 2].map((i) => call(handle, '/v1/sell', { uid: 'itemB' }, { 'x-idempotency-key': `s${i}` }, U)));
  expect(sells.filter((r) => r.status === 200).length).toBe(1);
});

test('HTTP entry: CORS only for the GitHub Pages origin, health, 401 without initData', async () => {
  const pre = await exports.default.fetch('https://api.test/v1/open', { method: 'OPTIONS', headers: { Origin: 'https://plainplug11-creator.github.io' } });
  expect(pre.status).toBe(204);
  expect(pre.headers.get('access-control-allow-origin')).toBe('https://plainplug11-creator.github.io');
  expect(pre.headers.get('access-control-allow-headers')).toContain('X-Idempotency-Key');
  const evil = await exports.default.fetch('https://api.test/health', { headers: { Origin: 'https://evil.example' } });
  expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  expect(await evil.json()).toEqual({ ok: true });
  const unauth = await exports.default.fetch('https://api.test/v1/bootstrap', { method: 'POST', body: '{}' });
  expect(unauth.status).toBe(401);
  expect(await unauth.json()).toEqual({ error: 'UNAUTHORIZED' });
  void env;
});

async function anyItemPrize() {
  const { PRIZES } = await import('../src/catalog.ts');
  return Object.values(PRIZES).find((p) => p.kind !== 'stars')!.id;
}

test('stale version aborts the whole batch atomically (optimistic concurrency guard)', async () => {
  const { handle, db } = makeApp();
  const U = '6006';
  await call(handle, '/v1/bootstrap', {}, {}, U);
  const u = await db.prepare('SELECT version, balance FROM users WHERE id = ?').bind(U).first<{ version: number; balance: number }>();
  const tx = new Tx(db);
  tx.guardUser(U, u!.version + 7); // wrong version
  tx.add('UPDATE users SET balance = 999 WHERE id = ?', U);
  const err = await tx.commit().then(() => null, (e) => e);
  expect(isConflict(err)).toBe(true);
  const after = await db.prepare('SELECT version, balance FROM users WHERE id = ?').bind(U).first<{ version: number; balance: number }>();
  expect(after).toEqual(u);
  const ok = new Tx(db);
  ok.guardUser(U, u!.version);
  ok.add('UPDATE users SET balance = 5 WHERE id = ?', U);
  await ok.commit();
  expect((await db.prepare('SELECT balance FROM users WHERE id = ?').bind(U).first<{ balance: number }>())!.balance).toBe(5);
});
