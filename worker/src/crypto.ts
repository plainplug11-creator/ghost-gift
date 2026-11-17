// Web Crypto helpers (no node:crypto). HMAC/SHA-256 run natively, well under the 10 ms CPU budget.
const enc = new TextEncoder();
type KeyInput = string | Uint8Array;

const toBytes = (k: KeyInput) => (typeof k === 'string' ? enc.encode(k) : k);

export async function hmacSha256(key: KeyInput | CryptoKey, data: string): Promise<Uint8Array> {
  const k = isCryptoKey(key) ? key : await importHmacKey(key);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

export function importHmacKey(key: KeyInput): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toBytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function sha256Hex(data: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(data))));
}

export function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return toHex(b);
}

export function toHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

/** Constant-time compare of two equal-length hex strings. */
export function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || a.length !== b.length) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function isCryptoKey(k: unknown): k is CryptoKey {
  return typeof k === 'object' && k !== null && !(k instanceof Uint8Array) && 'algorithm' in (k as object);
}
