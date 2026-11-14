import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthError, signInitData, verifyInitData } from '../src/auth.ts';

const TOKEN = 'test-bot-token-123';
const user = JSON.stringify({ id: 42, first_name: 'Ada', username: 'ada' });

test('accepts a valid freshly signed initData', () => {
  const raw = signInitData({ user, auth_date: String(Math.floor(Date.now() / 1000)) }, TOKEN);
  const out = verifyInitData(raw, TOKEN, 86400);
  assert.equal(out.user.id, 42);
  assert.equal(out.user.username, 'ada');
});

test('rejects a tampered hash', () => {
  const raw = signInitData({ user, auth_date: String(Math.floor(Date.now() / 1000)) }, TOKEN);
  const bad = raw.replace(/hash=[0-9a-f]+/, 'hash=' + 'ab'.repeat(32));
  assert.throws(() => verifyInitData(bad, TOKEN, 86400), AuthError);
});

test('rejects stale auth_date', () => {
  const raw = signInitData({ user, auth_date: String(Math.floor(Date.now() / 1000) - 48 * 3600) }, TOKEN);
  assert.throws(() => verifyInitData(raw, TOKEN, 86400), (e: unknown) => e instanceof AuthError && e.code === 'STALE_AUTH');
});

test('rejects a hash signed with a different token', () => {
  const raw = signInitData({ user, auth_date: String(Math.floor(Date.now() / 1000)) }, 'other-token');
  assert.throws(() => verifyInitData(raw, TOKEN, 86400), AuthError);
});
