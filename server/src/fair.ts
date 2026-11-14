import { createHash, createHmac, randomBytes } from 'node:crypto';

export function newSeed(bytes = 32) { return randomBytes(bytes).toString('hex'); }
export function seedHash(serverSeed: string) { return createHash('sha256').update(serverSeed).digest('hex'); }

/** Deterministic float in [0, 1) from HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}`). */
export function fairRoll(serverSeed: string, clientSeed: string, nonce: number): number {
  const hex = createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}`).digest('hex');
  return parseInt(hex.slice(0, 13), 16) / 2 ** 52;
}

export function verifyFair(input: { serverSeed: string; clientSeed: string; nonce: number; serverSeedHash: string }) {
  const hash = seedHash(input.serverSeed);
  if (hash !== input.serverSeedHash) return { ok: false as const, reason: 'hash_mismatch' as const, hash, roll: null };
  return { ok: true as const, hash, roll: fairRoll(input.serverSeed, input.clientSeed, input.nonce), reason: null };
}
