import { describe, expect, it } from 'vitest';
import { CASES, NFT_DROPS, PRIZES, bankFilter, caseStats, liveDrops } from '../src/catalog.ts';
import { cronTick } from '../src/delivery.ts';
import { makeFlowApp } from './fake-tg.ts';

describe('economy tables', () => {
  for (const c of CASES.filter((x) => x.price > 0)) {
    it(`${c.id} (${c.price}⭐) RTP 85–88% in every mode`, () => {
      const nft = Object.keys(NFT_DROPS[c.id] ?? {});
      for (const drops of [liveDrops(c), liveDrops(c, { nftInStock: nft }), liveDrops(c, { nftInStock: nft, luckPct: 10 })]) {
        const { rtp } = caseStats(c, drops);
        expect(rtp).toBeGreaterThan(0.85);
        expect(rtp).toBeLessThanOrEqual(0.88);
      }
      for (const k of nft) expect(PRIZES[k].value).toBeGreaterThan(c.price);
    });
  }
  it('the daily case is cheap and every drop exists', () => {
    const d = CASES.find((c) => c.price === 0)!;
    expect(caseStats(d, d.drops.map((x) => ({ ...x }))).ev).toBeLessThanOrEqual(4);
    for (const c of CASES) for (const x of c.drops) expect(PRIZES[x.prize], `${c.id}:${x.prize}`).toBeTruthy();
  });
  it('bank filter: below reserve and cap never allow big or unaffordable prizes', () => {
    const king = CASES.find((c) => c.id === 'king')!;
    const rules = { reserve: 3000, dailyBigCap: 20, bigMin: 250 };
    expect(bankFilter(king, king.drops, { balance: 100, bigToday: 0 }, rules).every((d) => PRIZES[d.prize].value <= king.price)).toBe(true);
    expect(bankFilter(king, king.drops, { balance: 9000, bigToday: 0 }, rules).every((d) => PRIZES[d.prize].value <= 9000 + 5000 - 3000)).toBe(true);
    expect(bankFilter(king, king.drops, { balance: 1e9, bigToday: 20 }, rules).every((d) => PRIZES[d.prize].value < 25000)).toBe(true);
  });
});

describe('cron', () => {
  it('flags deliveries stuck in "sending" and cleans old rows', async () => {
    const a = makeFlowApp();
    const old = Date.now() - 3600_000;
    await a.db.prepare("INSERT INTO deliveries (id, withdrawal_id, user_id, kind, prize_id, cost, status, attempts, next_at, created_at, updated_at) VALUES ('stuck1', 'wstuck1', '1', 'gift', 'heart', 15, 'sending', 1, 0, ?, ?)").bind(old, old).run();
    await a.db.prepare("INSERT INTO idempotency (key, user_id, response, created_at) VALUES ('old', '1', '{}', ?)").bind(Date.now() - 8 * 86400_000).run();
    await cronTick(a.app.ctx);
    expect((await a.db.prepare("SELECT status FROM deliveries WHERE id = 'stuck1'").first<{ status: string }>())!.status).toBe('unknown');
    expect(await a.db.prepare("SELECT 1 FROM idempotency WHERE key = 'old'").first()).toBeNull();
    expect(a.tg.of('sendGift')).toHaveLength(0);
  });
});
