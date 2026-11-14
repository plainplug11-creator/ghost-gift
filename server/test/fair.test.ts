import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fairRoll, newSeed, seedHash, verifyFair } from '../src/fair.ts';

test('seed hash is sha256 and roll is deterministic', () => {
  const serverSeed = 'abc123';
  const hash = seedHash(serverSeed);
  assert.equal(hash, seedHash(serverSeed));
  assert.equal(hash.length, 64);
  const a = fairRoll(serverSeed, 'client', 1);
  const b = fairRoll(serverSeed, 'client', 1);
  const c = fairRoll(serverSeed, 'client', 2);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(a >= 0 && a < 1);
});

test('verify succeeds only when the committed hash matches', () => {
  const serverSeed = newSeed();
  const serverSeedHash = seedHash(serverSeed);
  const ok = verifyFair({ serverSeed, clientSeed: 'c', nonce: 3, serverSeedHash });
  assert.equal(ok.ok, true);
  assert.equal(ok.roll, fairRoll(serverSeed, 'c', 3));
  const bad = verifyFair({ serverSeed: newSeed(), clientSeed: 'c', nonce: 3, serverSeedHash });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'hash_mismatch');
});
