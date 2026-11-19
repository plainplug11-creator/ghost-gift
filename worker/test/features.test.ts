import { describe, expect, it } from 'vitest';
import { signInitData } from '../src/auth.ts';
import { fairRoll } from '../src/fair.ts';
import { fairRollTag } from '../src/features.ts';
import { GAME_BETS, LUCK_CARDS, SLOTS, STREAK_REWARDS, WHEEL, levelInfo, slotsFaces, slotsPick, tableRtp, wheelPick, maxBet } from '../src/games-rules.ts';
import { nextProgress, weekKey, yesterdayKyiv } from '../src/progress.ts';
import { todayKyiv } from '../src/db.ts';
import { streakReminders } from '../src/bot.ts';
import { TOKEN, makeFlowApp } from './fake-tg.ts';

type App = ReturnType<typeof makeFlowApp>;
let nextUser = 90_000;
const newUser = () => String(++nextUser);

async function req(a: App, method: string, path: string, user: string, body?: unknown, extra: Record<string, string> = {}) {
  const init = await signInitData({ user: JSON.stringify({ id: Number(user), first_name: `P${user}`, language_code: 'ru' }), auth_date: String(Math.floor(Date.now() / 1000)) }, TOKEN);
  const r = await a.app.handle({ method, url: path, headers: { authorization: `tma ${init}`, 'x-device-id': `fd-${user}`, ...extra }, body: body === undefined ? '' : JSON.stringify(body), ip: `192.0.2.${Number(user) % 250}` });
  return r as { status: number; body: any };
}
async function player(a: App, balance = 0, body: unknown = {}) {
  const u = newUser();
  await req(a, 'POST', '/v1/bootstrap', u, body);
  await a.db.prepare('UPDATE users SET created_at = ?, balance = ? WHERE id = ?').bind(Date.now() - 10 * 86400_000, balance, u).run();
  return u;
}
const bal = async (a: App, u: string) => (await a.db.prepare('SELECT balance FROM users WHERE id = ?').bind(u).first<{ balance: number }>())!.balance;

describe('game tables', () => {
  it('wheel and slots RTP stay inside 85–88 % and whole-star payouts on every bet', () => {
    expect(tableRtp(WHEEL)).toBeGreaterThanOrEqual(0.85); expect(tableRtp(WHEEL)).toBeLessThanOrEqual(0.88);
    expect(tableRtp(SLOTS)).toBeGreaterThanOrEqual(0.85); expect(tableRtp(SLOTS)).toBeLessThanOrEqual(0.88);
    for (const b of GAME_BETS) for (const s of [...WHEEL, ...SLOTS]) expect(Number.isInteger(b * s.m)).toBe(true);
  });
  it('slot faces always illustrate the outcome', () => {
    for (let i = 0; i < 2000; i++) {
      const o = slotsPick(Math.random());
      const f = slotsFaces(o, Math.random());
      const g = f.filter((x) => x === 'ghost').length;
      const same = f[0] === f[1] && f[1] === f[2];
      if (o.id === 'x') { expect(g).toBe(0); expect(same).toBe(false); }
      if (o.id === 'g1') expect(g).toBe(1);
      if (o.id === 'g2') expect(g).toBe(2);
      if (o.id === 'g3') expect(g).toBe(3);
      if (['s3', 'c3', 'd3', 'f3'].includes(o.id)) { expect(same).toBe(true); expect(g).toBe(0); }
    }
  });
  it('max bet keeps the top payout above the bank reserve', () => {
    const rules = { reserve: 3000, dailyBigCap: 20, bigMin: 250 };
    expect(maxBet('wheel', { balance: 10_000, bigToday: 0 }, rules)).toBe(500);
    expect(maxBet('slots', { balance: 10_000, bigToday: 0 }, rules)).toBe(100);
    expect(maxBet('wheel', { balance: 3100, bigToday: 0 }, rules)).toBe(10);
    expect(maxBet('wheel', { balance: 2000, bigToday: 0 }, rules)).toBe(0);
    expect(maxBet('slots', { balance: 3150, bigToday: 0 }, rules)).toBe(0);
  });
  it('levels: rewards only on level-up and ≈1 % of the step', () => {
    expect(levelInfo(0).level).toBe(1);
    expect(levelInfo(100).level).toBe(2);
    const u = { xp: 90, stats_opens: 0, ach: '', quests: null, week_key: null, week_xp: 0 } as any;
    const p = nextProgress(u, { wager: 20, game: 'wheel', mult: 0 });
    expect(p.levelTo).toBe(2); expect(p.bonus).toBe(1); expect(p.unlocked).toContain('first_open');
  });
});

describe('wheel & slots endpoints', () => {
  it('wheel: debits the bet, pays bet×segment, and the roll is reproducible from the revealed seed', async () => {
    const a = makeFlowApp();
    const u = await player(a, 1000);
    const r = await req(a, 'POST', '/v1/wheel', u, { bet: 50 }, { 'x-idempotency-key': 'w1' });
    expect(r.status).toBe(200);
    const { fairness: f, index, payout, mult } = r.body;
    const roll = await fairRoll(f.serverSeed, f.clientSeed, f.nonce);
    expect(wheelPick(roll)).toBe(index);
    expect(mult).toBe(WHEEL[index].m);
    expect(payout).toBe(50 * mult);
    expect(r.body.balance).toBe(await bal(a, u) - (r.body.progress.levelBonus ?? 0) + (r.body.progress.levelBonus ?? 0));
    expect(await bal(a, u)).toBe(1000 - 50 + payout + r.body.progress.levelBonus);
    // idempotent replay
    const again = await req(a, 'POST', '/v1/wheel', u, { bet: 50 }, { 'x-idempotency-key': 'w1' });
    expect(again.body.roundId).toBe(r.body.roundId);
    expect(await bal(a, u)).toBe(1000 - 50 + payout + r.body.progress.levelBonus);
  });
  it('slots: faces are derived from the round secrets', async () => {
    const a = makeFlowApp();
    const u = await player(a, 500);
    const r = await req(a, 'POST', '/v1/slots', u, { bet: 10 });
    expect(r.status).toBe(200);
    const f = r.body.fairness;
    const o = slotsPick(await fairRoll(f.serverSeed, f.clientSeed, f.nonce));
    expect(r.body.outcome).toBe(o.id);
    expect(r.body.faces).toEqual(slotsFaces(o, await fairRollTag(f.serverSeed, f.clientSeed, f.nonce, 'reels')));
    expect(r.body.payout).toBe(10 * o.m);
  });
  it('rejects bad bets, empty balance and bets the bank cannot cover', async () => {
    const a = makeFlowApp({ bankStart: 3500, bankReserve: 3000 });
    const u = await player(a, 5000);
    await a.db.prepare('UPDATE bank SET balance = 3500 WHERE id = 1').run();
    expect((await req(a, 'POST', '/v1/wheel', u, { bet: 7 })).status).toBe(400);
    expect((await req(a, 'POST', '/v1/wheel', u, { bet: 100 })).body.error).toBe('LIMIT');
    expect((await req(a, 'POST', '/v1/wheel', u, { bet: 50 })).status).toBe(200);
    const poor = await player(a, 5);
    expect((await req(a, 'POST', '/v1/slots', poor, { bet: 10 })).body.error).toBe('NO_BALANCE');
    await a.db.prepare('UPDATE bank SET balance = 3300 WHERE id = 1').run();
    const pr = await req(a, 'GET', '/v1/progress', u);
    expect(pr.body.limits.slots).toBe(0);
    expect(pr.body.limits.wheel).toBe(20);
    await a.db.prepare('UPDATE bank SET balance = 1000000 WHERE id = 1').run();
  });
});

describe('luck card, streak, quests', () => {
  it('luck card: once per day, boost visible in progress', async () => {
    const a = makeFlowApp();
    const u = await player(a);
    const r = await req(a, 'POST', '/v1/luck/draw', u, {});
    expect(r.status).toBe(200);
    expect(LUCK_CARDS.map((c) => c.pct)).toContain(r.body.pct);
    expect((await req(a, 'POST', '/v1/luck/draw', u, {})).body.error).toBe('DAILY_COOLDOWN');
    const p = await req(a, 'GET', '/v1/progress', u);
    expect(p.body.luck.pct).toBe(r.body.pct);
    expect(p.body.luck.drawnToday).toBe(true);
  });
  it('streak: consecutive days count up, a gap restarts, flagged players get no Stars', async () => {
    const a = makeFlowApp();
    const u = await player(a, 0);
    await a.db.prepare('UPDATE users SET streak_day = ?, streak_count = 6 WHERE id = ?').bind(yesterdayKyiv(), u).run();
    const r = await req(a, 'POST', '/v1/streak/claim', u, {});
    expect(r.body.count).toBe(7);
    expect(r.body.reward).toBe(STREAK_REWARDS[6]);
    expect(r.body.unlocked).toContain('streak_7');
    expect((await req(a, 'POST', '/v1/streak/claim', u, {})).body.error).toBe('DAILY_COOLDOWN');
    const v = await player(a, 0);
    await a.db.prepare("UPDATE users SET streak_day = '2020-01-01', streak_count = 5, flagged = 1, risk_score = 70 WHERE id = ?").bind(v).run();
    const r2 = await req(a, 'POST', '/v1/streak/claim', v, {});
    expect(r2.body.count).toBe(1); expect(r2.body.reward).toBe(0);
  });
  it('quests: progress from real rounds, claim once', async () => {
    const a = makeFlowApp();
    const u = await player(a, 2000);
    expect((await req(a, 'POST', '/v1/quests/claim', u, { id: 'wheel3' })).status).toBe(400);
    for (let i = 0; i < 3; i++) expect((await req(a, 'POST', '/v1/wheel', u, { bet: 10 })).status).toBe(200);
    const before = await bal(a, u);
    const c = await req(a, 'POST', '/v1/quests/claim', u, { id: 'wheel3' });
    expect(c.status).toBe(200);
    expect(await bal(a, u)).toBe(before + 1 + c.body.progress.levelBonus);
    expect((await req(a, 'POST', '/v1/quests/claim', u, { id: 'wheel3' })).body.error).toBe('DAILY_COOLDOWN');
    const p = await req(a, 'GET', '/v1/progress', u);
    expect(p.body.quests.wheel).toBe(3);
    expect(p.body.quests.claimed).toContain('wheel3');
    expect(p.body.quests.day).toBe(todayKyiv());
  });
});

describe('inventory, social, referrals', () => {
  it('sell-many sells all or nothing', async () => {
    const a = makeFlowApp();
    const u = await player(a, 0);
    const uids = ['sa', 'sb'].map((k) => `${k}${u}`);
    for (const [i, uid] of uids.entries()) await a.db.prepare("INSERT INTO inventory (uid, user_id, prize_id, case_id, won_at, status) VALUES (?, ?, ?, 'neon', ?, 'owned')").bind(uid, u, i ? 'cup' : 'rose', Date.now()).run();
    expect((await req(a, 'POST', '/v1/sell-many', u, { uids: [...uids, 'nope'] })).status).toBe(404);
    const r = await req(a, 'POST', '/v1/sell-many', u, { uids });
    expect(r.body.credited).toBe(125);
    expect(await bal(a, u)).toBe(125);
  });
  it('feed shows real wins (opt-out hides the name) and the weekly leaderboard ranks XP', async () => {
    const a = makeFlowApp();
    const u = await player(a, 0);
    await a.db.prepare("INSERT INTO plays (user_id, game, round_id, bet, payout, prize_id, rarity, created_at) VALUES (?, 'wheel', 'r1', 50, 500, 'w0', 'legendary', ?)").bind(u, Date.now()).run();
    let f = await req(a, 'GET', '/v1/feed', u);
    expect(f.body.feed.find((x: any) => x.payout === 500 && x.name === `P${u}`)).toBeTruthy();
    await req(a, 'POST', '/v1/settings', u, { hideFeed: true });
    f = await req(a, 'GET', '/v1/feed', u);
    expect(f.body.feed.find((x: any) => x.payout === 500).name).toBeNull();
    await a.db.prepare('UPDATE users SET week_key = ?, week_xp = 999999 WHERE id = ?').bind(weekKey(), u).run();
    const lb = await req(a, 'GET', '/v1/leaderboard', u);
    expect(lb.body.me.rank).toBe(1);
    expect(lb.body.top[0].me).toBe(true);
  });
  it('referral: start param links a new player; the friend’s top-up pays both sides once', async () => {
    const a = makeFlowApp();
    const inviter = await player(a, 0);
    const friend = newUser();
    await req(a, 'POST', '/v1/bootstrap', friend, { ref: `ref_${inviter}` });
    expect((await a.db.prepare('SELECT referred_by FROM users WHERE id = ?').bind(friend).first<{ referred_by: string }>())!.referred_by).toBe(inviter);
    const hook = (charge: string, stars: number) => a.app.handle({ method: 'POST', url: '/v1/webhook/telegram', headers: {}, ip: '149.154.167.1',
      body: JSON.stringify({ update_id: Math.floor(Math.random() * 1e9), message: { from: { id: Number(friend) }, successful_payment: { telegram_payment_charge_id: charge, total_amount: stars, currency: 'XTR', invoice_payload: friend } } }) });
    await hook(`ch-${friend}-1`, 500);
    expect(await bal(a, friend)).toBe(550);
    expect(await bal(a, inviter)).toBe(50);
    await hook(`ch-${friend}-1`, 500); // duplicate delivery
    expect(await bal(a, inviter)).toBe(50);
    await hook(`ch-${friend}-2`, 100);
    expect(await bal(a, friend)).toBe(650);
    expect(await bal(a, inviter)).toBe(60);
    // self-referral / existing player: ignored
    const old = await player(a, 0);
    await req(a, 'POST', '/v1/bootstrap', old, { ref: `ref_${inviter}` });
    expect((await a.db.prepare('SELECT referred_by FROM users WHERE id = ?').bind(old).first<{ referred_by: string | null }>())!.referred_by).toBeNull();
  });
  it('bot /start with a deep link attaches the referrer and opens the chat for reminders', async () => {
    const a = makeFlowApp();
    const inviter = await player(a, 0);
    const friend = newUser();
    a.tg.handlers.sendPhoto = () => ({ message_id: 1 });
    await a.app.handle({ method: 'POST', url: '/v1/webhook/telegram', headers: {}, ip: '149.154.167.1',
      body: JSON.stringify({ update_id: Math.floor(Math.random() * 1e9), message: { text: `/start ref_${inviter}`, chat: { id: Number(friend), type: 'private' }, from: { id: Number(friend), first_name: 'F', language_code: 'ru' } } }) });
    const row = await a.db.prepare('SELECT referred_by, bot_started FROM users WHERE id = ?').bind(friend).first<{ referred_by: string; bot_started: number }>();
    expect(row).toEqual({ referred_by: inviter, bot_started: 1 });
    expect(a.tg.of('sendPhoto').length).toBe(1);
  });
  it('streak reminders go only to opted-in players whose streak ends tonight, once a day', async () => {
    const a = makeFlowApp();
    const u = await player(a, 0);
    await a.db.prepare('UPDATE users SET notify = 1, bot_started = 1, streak_day = ?, streak_count = 3 WHERE id = ?').bind(yesterdayKyiv(), u).run();
    // 19:30 Kyiv today
    const day = todayKyiv();
    const at = Date.parse(`${day}T17:30:00Z`);
    const n1 = await streakReminders(a.app.ctx, at, 500);
    expect(n1).toBeGreaterThanOrEqual(1);
    const n2 = await streakReminders(a.app.ctx, at, 500);
    expect(n2).toBe(0);
  });
});
