import { createHmac, timingSafeEqual } from 'node:crypto';

export class AuthError extends Error {
  constructor(public code: 'UNAUTHORIZED' | 'STALE_AUTH', msg = code) { super(msg); }
}

export interface TelegramUser { id: number; username?: string; first_name?: string }

/** Build a signed initData string — used by tests (and never logged). */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const hash = hmacHex(secretKey(botToken), dataCheckString(fields));
  const q = new URLSearchParams({ ...fields, hash });
  return q.toString();
}

export function verifyInitData(initData: string, botToken: string, maxAgeSec: number, now = Date.now()): { user: TelegramUser; authDate: number } {
  if (!initData || !botToken) throw new AuthError('UNAUTHORIZED');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') || '';
  params.delete('hash');
  const fields: Record<string, string> = {};
  for (const [k, v] of params) fields[k] = v;
  const expected = hmacHex(secretKey(botToken), dataCheckString(fields));
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

function secretKey(botToken: string) {
  return createHmac('sha256', 'WebAppData').update(botToken).digest();
}
function dataCheckString(fields: Record<string, string>) {
  return Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
}
function hmacHex(key: Buffer, data: string) {
  return createHmac('sha256', key).update(data).digest('hex');
}
function safeEqualHex(a: string, b: string) {
  if (!/^[0-9a-f]+$/i.test(a) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
