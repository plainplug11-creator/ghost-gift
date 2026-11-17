import { hmacSha256, randomHex, sha256Hex, toHex } from './crypto.ts';

export function newSeed(bytes = 32) { return randomHex(bytes); }
export function seedHash(serverSeed: string) { return sha256Hex(serverSeed); }

/** Deterministic float in [0, 1) from HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}`). Same as the Node server. */
export async function fairRoll(serverSeed: string, clientSeed: string, nonce: number): Promise<number> {
  const hex = toHex(await hmacSha256(serverSeed, `${clientSeed}:${nonce}`));
  return parseInt(hex.slice(0, 13), 16) / 2 ** 52;
}

export async function verifyFair(input: { serverSeed: string; clientSeed: string; nonce: number; serverSeedHash: string }) {
  const hash = await seedHash(String(input.serverSeed ?? ''));
  if (hash !== input.serverSeedHash) return { ok: false as const, reason: 'hash_mismatch' as const, hash, roll: null };
  return { ok: true as const, hash, roll: await fairRoll(input.serverSeed, input.clientSeed, input.nonce), reason: null };
}
