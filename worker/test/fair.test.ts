import { expect, test } from 'vitest';
import { fairRoll, newSeed, seedHash, verifyFair } from '../src/fair.ts';

test('seed hash is sha256 and roll is deterministic', async () => {
  const serverSeed = 'abc123';
  const hash = await seedHash(serverSeed);
  expect(hash).toBe(await seedHash(serverSeed));
  expect(hash.length).toBe(64);
  // known vector: same value node:crypto produces, so old rounds stay verifiable
  expect(hash).toBe('6ca13d52ca70c883e0f0bb101e425a89e8624de51db2d2392593af6a84118090');
  const a = await fairRoll(serverSeed, 'client', 1);
  const b = await fairRoll(serverSeed, 'client', 1);
  const c = await fairRoll(serverSeed, 'client', 2);
  expect(a).toBe(b);
  expect(a).not.toBe(c);
  expect(a >= 0 && a < 1).toBe(true);
  expect(a).toBe(0.012888509656454605);
});

test('verify succeeds only when the committed hash matches', async () => {
  const serverSeed = newSeed();
  const serverSeedHash = await seedHash(serverSeed);
  const ok = await verifyFair({ serverSeed, clientSeed: 'c', nonce: 3, serverSeedHash });
  expect(ok.ok).toBe(true);
  expect(ok.roll).toBe(await fairRoll(serverSeed, 'c', 3));
  const bad = await verifyFair({ serverSeed: newSeed(), clientSeed: 'c', nonce: 3, serverSeedHash });
  expect(bad.ok).toBe(false);
  expect(bad.reason).toBe('hash_mismatch');
});
