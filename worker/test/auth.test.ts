import { describe, expect, test } from 'vitest';
import { AuthError, signInitData, verifyInitData } from '../src/auth.ts';

const TOKEN = 'test-bot-token-123';
const user = JSON.stringify({ id: 42, first_name: 'Ada', username: 'ada' });
const now = () => String(Math.floor(Date.now() / 1000));

describe('initData', () => {
  test('accepts a valid freshly signed initData', async () => {
    const raw = await signInitData({ user, auth_date: now() }, TOKEN);
    const out = await verifyInitData(raw, TOKEN, 86400);
    expect(out.user.id).toBe(42);
    expect(out.user.username).toBe('ada');
    // initData signed by the Node server (node:crypto) verifies identically
    const fromNode = 'user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Ada%22%7D&auth_date=1700000000&hash=7f359b7103b53c4af0e09c29f6177b234696420cee41a02d58fc470beb776ba1';
    expect((await verifyInitData(fromNode, TOKEN, 86400, 1700000000 * 1000)).user.id).toBe(42);
  });

  test('rejects a tampered hash', async () => {
    const raw = await signInitData({ user, auth_date: now() }, TOKEN);
    const bad = raw.replace(/hash=[0-9a-f]+/, 'hash=' + 'ab'.repeat(32));
    await expect(verifyInitData(bad, TOKEN, 86400)).rejects.toBeInstanceOf(AuthError);
  });

  test('rejects stale auth_date', async () => {
    const raw = await signInitData({ user, auth_date: String(Math.floor(Date.now() / 1000) - 48 * 3600) }, TOKEN);
    await expect(verifyInitData(raw, TOKEN, 86400)).rejects.toMatchObject({ code: 'STALE_AUTH' });
  });

  test('rejects a hash signed with a different token', async () => {
    const raw = await signInitData({ user, auth_date: now() }, 'other-token');
    await expect(verifyInitData(raw, TOKEN, 86400)).rejects.toBeInstanceOf(AuthError);
  });
});
