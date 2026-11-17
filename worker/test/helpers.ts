import { env } from 'cloudflare:workers';
import { createApp, type AppReq } from '../src/app.ts';
import { signInitData } from '../src/auth.ts';
import { loadConfig } from '../src/config.ts';

const TOKEN = 'idem-test-token';
export const USER = '1001';

async function initData(user = USER) {
  return signInitData({ user: JSON.stringify({ id: Number(user), first_name: 'T' }), auth_date: String(Math.floor(Date.now() / 1000)) }, TOKEN);
}

type Handle = (r: AppReq) => Promise<{ status: number; body: unknown }>;
export async function call(handle: Handle, path: string, body?: unknown, extra: Record<string, string> = {}, user = USER) {
  return handle({
    method: body === undefined && !path.includes('bootstrap') && !path.includes('webhook') && !path.includes('open') && !path.includes('sell') ? 'GET' : 'POST',
    url: path,
    headers: { authorization: `tma ${await initData(user)}`, 'content-type': 'application/json', 'x-device-id': `dev-${user}`, ...extra },
    body: body === undefined ? '' : JSON.stringify(body),
    ip: '203.0.113.10',
  });
}

export function pay(handle: Handle, chargeId: string, stars: number, user = USER) {
  return handle({
    method: 'POST', url: '/v1/webhook/telegram', headers: { 'content-type': 'application/json' }, ip: '127.0.0.1',
    body: JSON.stringify({ message: { from: { id: Number(user) }, successful_payment: { telegram_payment_charge_id: chargeId, total_amount: stars, currency: 'XTR', invoice_payload: user } } }),
  });
}

export const makeApp = (over = {}) =>
  createApp(env.DB, loadConfig({}, { botToken: TOKEN, bankStart: 50_000, bankReserve: 0, dailyBigPrizeCap: 100, ...over }));

