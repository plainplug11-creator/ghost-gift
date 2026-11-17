import { describe, expect, it } from 'vitest';
import { Tg, TgError } from '../src/telegram.ts';

const resp = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
describe('Tg client', () => {
  it('retries 429 with retry_after and 5xx for normal calls', async () => {
    const seq = [resp(429, { ok: false, error_code: 429, description: 'flood', parameters: { retry_after: 0 } }), resp(502, { ok: false, error_code: 502, description: 'bad gw' }), resp(200, { ok: true, result: 7 })];
    let n = 0;
    const tg = new Tg('t', (async () => seq[n++]) as typeof fetch);
    expect(await tg.call('getMe')).toBe(7);
    expect(n).toBe(3);
  });
  it('never retries a money call after a network error', async () => {
    let n = 0;
    const tg = new Tg('t', (async () => { n++; throw new Error('reset'); }) as typeof fetch);
    await expect(tg.call('sendGift', {}, { money: true })).rejects.toMatchObject({ network: true });
    expect(n).toBe(1);
  });
  it('surfaces 400 errors with the description', async () => {
    const tg = new Tg('t', (async () => resp(400, { ok: false, error_code: 400, description: 'BALANCE_TOO_LOW' })) as typeof fetch);
    const e = await tg.call('sendGift', {}, { money: true }).catch((x) => x);
    expect(e).toBeInstanceOf(TgError);
    expect(e.description).toBe('BALANCE_TOO_LOW');
  });
});
