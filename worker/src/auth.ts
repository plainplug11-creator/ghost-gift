import { hmacSha256, importHmacKey, safeEqualHex, toHex } from './crypto.ts';

export class AuthError extends Error {
  constructor(public code: 'UNAUTHORIZED' | 'STALE_AUTH', msg = code) { super(msg); }
}

export interface TelegramUser { id: number; username?: string; first_name?: string }

// Derived key HMAC_SHA256("WebAppData", botToken) cached per isolate.
const keyCache = new Map<string, Promise<CryptoKey>>();
function secretKey(botToken: string): Promise<CryptoKey> {
  let k = keyCache.get(botToken);
  if (!k) {
    k = hmacSha256('WebAppData', botToken).then(importHmacKey);
    if (keyCache.size > 4) keyCache.clear();
    keyCache.set(botToken, k);
  }
  return k;
}

function dataCheckString(fields: Record<string, string>) {
  return Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
}

/** Build a signed initData string — used by tests (and never logged). */
export async function signInitData(fields: Record<string, string>, botToken: string): Promise<string> {
  const hash = toHex(await hmacSha256(await secretKey(botToken), dataCheckString(fields)));
  return new URLSearchParams({ ...fields, hash }).toString();
}

export async function verifyInitData(initData: string, botToken: string, maxAgeSec: number, now = Date.now()): Promise<{ user: TelegramUser; authDate: number }> {
  if (!initData || !botToken) throw new AuthError('UNAUTHORIZED');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') || '';
  params.delete('hash');
  const fields: Record<string, string> = {};
  for (const [k, v] of params) fields[k] = v;
  const expected = toHex(await hmacSha256(await secretKey(botToken), dataCheckString(fields)));
  if (!safeEqualHex(hash, expected)) throw new AuthError('UNAUTHORIZED');

  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate)) throw new AuthError('UNAUTHORIZED');
  const age = now / 1000 - authDate;
  if (age > maxAgeSec || age < -60) throw new AuthError('STALE_AUTH');

  let user: TelegramUser | null = null;
  try { user = JSON.parse(fields.user || ''); } catch { /* fall through */ }
  if (!user || !Number.isFinite(user.id)) throw new AuthError('UNAUTHORIZED');
  return { user, authDate };
}
