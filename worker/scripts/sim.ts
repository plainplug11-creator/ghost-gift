// Economy proof for every case: exact RTP (base / +NFT / +max luck), variance, Monte-Carlo via the real
// HMAC roll + pick path, and a multi-day bank simulation with bankFilter() (reserve, daily big-prize cap,
// affordability). Run: npm run sim [opensPerCase] [days]
import { CASES, LUCK, NFT_DROPS, PRIZES, bankFilter, caseStats, isBigPrize, liveDrops, type CaseDef, type CaseDrop } from '../src/catalog.ts';
import { createHmac, randomBytes } from 'node:crypto';
import { GAME_BETS, SLOTS, STREAK_REWARDS, WHEEL, QUESTS, maxBet, slotsPick, tableRtp, wheelPick } from '../src/games-rules.ts';

const pick = (drops: CaseDrop[], r: number) => {
  const total = drops.reduce((s, d) => s + d.weight, 0);
  let x = r * total;
  for (const d of drops) { x -= d.weight; if (x < 0) return PRIZES[d.prize]; }
  return PRIZES[drops[drops.length - 1].prize];
};
let ctr = 0;
const seed = randomBytes(32).toString('hex');
const roll = () => parseInt(createHmac('sha256', seed).update(`sim:${++ctr}`).digest('hex').slice(0, 13), 16) / 2 ** 52;
const N = Number(process.argv[2] || 100_000);
const DAYS = Number(process.argv[3] || 60);
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
let fail = false;

console.log(`\n1) Per-case RTP / variance (NFT collections counted as if in stock; luck = +${LUCK.maxPct}% on cases ≤ ${LUCK.maxCasePrice}⭐)`);
console.log('case      price   base     +NFT     +luck    MC(n)    σ/open(⭐)  σ/price  opens for 95% house-ahead');
for (const c of CASES) {
  const all = Object.keys(NFT_DROPS[c.id] ?? {});
  const base = caseStats(c, liveDrops(c));
  const drops = liveDrops(c, { nftInStock: all });
  const nft = caseStats(c, drops);
  const luck = caseStats(c, liveDrops(c, { nftInStock: all, luckPct: LUCK.maxPct }));
  const total = drops.reduce((s, d) => s + d.weight, 0);
  const varr = drops.reduce((s, d) => s + (d.weight / total) * (PRIZES[d.prize].value - nft.ev) ** 2, 0);
  const sd = Math.sqrt(varr);
  let sum = 0;
  for (let i = 0; i < N; i++) sum += pick(drops, roll()).value;
  const mc = sum / N;
  const edge = c.price - nft.ev; // house profit per open
  const opens95 = c.price ? Math.ceil((1.645 * sd / edge) ** 2) : 0;
  console.log(`${c.id.padEnd(9)} ${String(c.price).padStart(5)}   ${c.price ? pct(base.rtp) : '   -  '}   ${c.price ? pct(nft.rtp) : '   -  '}   ${c.price ? pct(luck.rtp) : '   -  '}   ${c.price ? pct(mc / c.price) : mc.toFixed(2) + '⭐ '}   ${sd.toFixed(1).padStart(8)}   ${c.price ? (sd / c.price).toFixed(2) : '-'}     ${c.price ? opens95 : '-'}`);
  if (c.price) {
    for (const r of [base.rtp, nft.rtp, luck.rtp]) if (r < 0.85 - 1e-9 || r > 0.88 + 1e-9) { fail = true; console.log(`  ✗ ${c.id} RTP ${pct(r)} outside 85–88%`); }
    for (const [k] of Object.entries(NFT_DROPS[c.id] ?? {})) {
      const v = PRIZES[k].value;
      if (v <= c.price || v > 10 * c.price) { fail = true; console.log(`  ✗ ${c.id}: NFT ${k} must satisfy price < value ≤ 10×price`); }
    }
  } else if (base.ev > 4) { fail = true; console.log('  ✗ daily EV too high'); }
}

// 1b) Wheel / Slots exact RTP + Monte-Carlo
console.log('\n1b) Games');
for (const [name, table, pickM] of [['wheel', WHEEL, () => WHEEL[wheelPick(roll())].m], ['slots', SLOTS, () => slotsPick(roll()).m]] as const) {
  const exact = tableRtp(table as { m: number; w: number }[]);
  let sum = 0, hits = 0;
  for (let i = 0; i < N * 5; i++) { const m = (pickM as () => number)(); sum += m; if (m >= 1) hits++; }
  const mc = sum / (N * 5);
  const whole = GAME_BETS.every((b) => (table as { m: number }[]).every((x) => Number.isInteger(b * x.m)));
  console.log(`${name.padEnd(6)} exact ${pct(exact)} · MC ${pct(mc)} · hit rate (≥1×) ${pct(hits / (N * 5))} · whole-star payouts on all bets: ${whole}`);
  if (exact < 0.85 || exact > 0.88 || !whole) { fail = true; console.log(`  ✗ ${name} RTP/payout rule`); }
}

// 2) Bank simulation: realistic mix of opens per day, bank start/reserve/cap as in wrangler.toml.
const rules = { reserve: 3000, dailyBigCap: 20, bigMin: 250 };
const START = 10_000;
const gameMix0: Record<'wheel' | 'slots', Record<number, number>> = {
  wheel: { 10: 300, 20: 200, 50: 120, 100: 50, 200: 15, 500: 5 },
  slots: { 10: 300, 20: 200, 50: 100, 100: 40 },
};
const QUEST_MAX = QUESTS.reduce((s, q) => s + q.stars, 0);
/** daily: players claiming the streak, players finishing every quest, referral payout share of top-ups (inviter 10 % + friend's first-top-up 10 %, assume half are first top-ups → 15 %) */
const BONUS0 = { streakUsers: 600, questUsers: 200, refPct: 0.15, topups: 20_000 };
const mix0: Record<string, number> = { daily: 600, spark: 900, lantern: 700, autumn: 500, neon: 350, ghost: 200, star: 80, diamond: 40, legend: 20, aurora: 8, phantom: 4, king: 3 };
function runBank(label: string, scale: number) {
const k = (n: number) => Math.max(0, Math.round(n * scale));
  const mix = Object.fromEntries(Object.entries(mix0).map(([c, n]) => [c, k(n)]));
  const gameMix = { wheel: Object.fromEntries(Object.entries(gameMix0.wheel).map(([b, n]) => [b, k(n)])), slots: Object.fromEntries(Object.entries(gameMix0.slots).map(([b, n]) => [b, k(n)])) } as Record<'wheel' | 'slots', Record<number, number>>;
  const BONUS = { streakUsers: k(BONUS0.streakUsers), questUsers: k(BONUS0.questUsers), refPct: BONUS0.refPct, topups: k(BONUS0.topups) };
  console.log(`\n2${label}) Bank simulation: ${DAYS} days × ${Object.values(mix).reduce((a, b) => a + b, 0)} opens/day, start ${START}⭐, reserve ${rules.reserve}, cap ${rules.dailyBigCap} big/day, NFT in stock`);
let worstMin = Infinity; let negatives = 0; let refused = 0; let spins = 0; let bonusTotal = 0; const finals: number[] = []; let filtered = 0; let opens = 0;
const RUNS = 20;
for (let run = 0; run < RUNS; run++) {
  let bank = START; let min = bank;
  for (let day = 0; day < DAYS; day++) {
    let big = 0;
    const queue: CaseDef[] = [];
    for (const c of CASES) for (let i = 0; i < (mix[c.id] ?? 0); i++) queue.push(c);
    for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(roll() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
    let wager = 0;
    for (const c of queue) {
      const full = liveDrops(c, { nftInStock: Object.keys(NFT_DROPS[c.id] ?? {}) });
      const drops = bankFilter(c, full, { balance: bank, bigToday: big }, rules);
      if (drops.length !== full.length) filtered++;
      const p = pick(drops, roll());
      bank += c.price - p.value;
      wager += c.price;
      if (isBigPrize(p.value, c.price, rules.bigMin)) big++;
      opens++;
      if (bank < 0) negatives++;
      min = Math.min(min, bank);
    }
    // wheel + slots rounds (bet refused when the bank can't cover the top payout)
    for (const [game, mixG] of Object.entries(gameMix) as ['wheel' | 'slots', Record<number, number>][]) {
      for (const [betS, n] of Object.entries(mixG)) {
        const bet = Number(betS);
        for (let i = 0; i < n; i++) {
          if (bet > maxBet(game, { balance: bank, bigToday: big }, rules)) { refused++; continue; }
          const m = game === 'wheel' ? WHEEL[wheelPick(roll())].m : slotsPick(roll()).m;
          const pay = Math.round(bet * m);
          bank += bet - pay; wager += bet; spins++;
          if (bank < 0) negatives++;
          min = Math.min(min, bank);
        }
      }
    }
    // free/funded bonuses paid out of the bank: streak, quests, level rakeback (1 % of wager), referrals
    const bonus = Math.round(BONUS.streakUsers * (STREAK_REWARDS.reduce((a, b) => a + b, 0) / 7) + BONUS.questUsers * QUEST_MAX + 0.01 * wager + BONUS.refPct * BONUS.topups);
    bank -= bonus; bonusTotal += bonus;
    if (bank < 0) negatives++;
    min = Math.min(min, bank);
  }
  worstMin = Math.min(worstMin, min);
  finals.push(bank);
}
finals.sort((a, b) => a - b);
console.log(`   + wheel/slots ${Object.values(gameMix).reduce((a, m) => a + Object.values(m).reduce((x, y) => x + y, 0), 0)} spins/day (refused by the bank limit: ${pct(refused / Math.max(1, refused + spins))}) · bonuses paid ${Math.round(bonusTotal / RUNS / DAYS)}⭐/day (streak ${BONUS.streakUsers} players, all quests ${BONUS.questUsers}, level 1 %, referrals ${BONUS.refPct * 100}% of ${BONUS.topups}⭐ top-ups)`);
console.log(`   worst bank low: ${worstMin}⭐ · negative moments: ${negatives} · final bank median ${finals[Math.floor(RUNS / 2)]}⭐ (min ${finals[0]}, max ${finals[RUNS - 1]}) · opens with a protective filter: ${pct(filtered / opens)}`);
if (negatives > 0 || worstMin < 0) { fail = true; console.log('  ✗ bank went negative'); }
if (scale >= 1 ? finals[0] <= START : finals[Math.floor(RUNS / 2)] <= START) { fail = true; console.log(scale >= 1 ? '  ✗ a run ended with less than the starting bank' : '  ✗ median run ended with less than the starting bank'); }
  if (scale < 1) console.log(`   runs ending above the start: ${finals.filter((f) => f > START).length}/${RUNS} (small samples are noisy; the reserve keeps the bank ≥ 0 regardless)`);

}
runBank('a', 1);
runBank('b · small launch', 0.02);

if (fail) { console.log('\nFAIL'); process.exit(1); }
console.log('\nOK: every paid case 85–88% (base, with NFT stock, with max luck); wheel/slots 85–88%; bonuses included; NFT only where price < value ≤ 10×; daily EV ≤ 4⭐; bank never negative and grows.');
