import { env } from 'cloudflare:workers';
import { createApp } from '../src/app.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { TgError, type TgApi } from '../src/telegram.ts';

export const GIFTS = [
  { id: 'g-heart', star_count: 15, sticker: { emoji: '💝' } },
  { id: 'g-bear', star_count: 15, sticker: { emoji: '🧸' } },
  { id: 'g-cup', star_count: 100, sticker: { emoji: '🏆' } },
];

type Handler = (p: Record<string, any>) => unknown;
export class FakeTg implements TgApi {
  calls: { method: string; params: Record<string, any> }[] = [];
  stars = 100_000;
  handlers: Record<string, Handler> = {};
  async call<T>(method: string, params: Record<string, any> = {}): Promise<T> {
    this.calls.push({ method, params });
    const h = this.handlers[method];
    if (h) return h(params) as T;
    switch (method) {
      case 'getMyStarBalance': return { amount: this.stars } as T;
      case 'getAvailableGifts': return { gifts: GIFTS } as T;
      case 'createInvoiceLink': return `https://t.me/$inv_${params.payload}` as T;
      case 'sendMessage': return { message_id: this.calls.length } as T;
      case 'sendGift': case 'giftPremiumSubscription': case 'transferGift':
      case 'answerPreCheckoutQuery': case 'answerCallbackQuery': case 'editMessageText': return true as T;
      default: throw new TgError(400, `unexpected ${method}`, 0, false);
    }
  }
  of(method: string) { return this.calls.filter((c) => c.method === method); }
}

export const TOKEN = 'flow-test-token';
export function makeFlowApp(over: Partial<Config> = {}) {
  const tg = new FakeTg();
  const pending: Promise<unknown>[] = [];
  const cfg = loadConfig({}, {
    botToken: TOKEN, bankStart: 1_000_000, bankReserve: 0, dailyBigPrizeCap: 1000,
    rateLimitPerMin: 10_000, rateBurst: 10_000, openLimitPerMin: 10_000, autoclickMinMs: 0, autoclickRegularStddevMs: -1,
    adminClaimCode: 'c0ffee', ...over,
  });
  const app = createApp(env.DB, cfg, { tg, waitUntil: (p) => { pending.push(p); } });
  const settle = async () => { while (pending.length) await pending.shift(); };
  return { app, tg, settle, db: env.DB };
}
