// Economy proof for every case: exact RTP (base / +NFT / +max luck), variance, Monte-Carlo via the real
// HMAC roll + pick path, and a multi-day bank simulation with bankFilter() (reserve, daily big-prize cap,
// affordability). Run: npm run sim [opensPerCase] [days]
import { CASES, LUCK, NFT_DROPS, PRIZES, bankFilter, caseStats, isBigPrize, liveDrops, type CaseDef, type CaseDrop } from '../src/catalog.ts';
import { createHmac, randomBytes } from 'node:crypto';

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

// 2) Bank simulation: realistic mix of opens per day, bank start/reserve/cap as in wrangler.toml.
const rules = { reserve: 3000, dailyBigCap: 20, bigMin: 250 };
const START = 10_000;
const mix: Record<string, number> = { daily: 600, spark: 900, lantern: 700, autumn: 500, neon: 350, ghost: 200, star: 80, diamond: 40, legend: 20, aurora: 8, phantom: 4, king: 3 };
console.log(`\n2) Bank simulation: ${DAYS} days × ${Object.values(mix).reduce((a, b) => a + b, 0)} opens/day, start ${START}⭐, reserve ${rules.reserve}, cap ${rules.dailyBigCap} big/day, NFT in stock`);
let worstMin = Infinity; let negatives = 0; const finals: number[] = []; let filtered = 0; let opens = 0;
const RUNS = 20;
for (let run = 0; run < RUNS; run++) {
  let bank = START; let min = bank;
  for (let day = 0; day < DAYS; day++) {
    let big = 0;
    const queue: CaseDef[] = [];
    for (const c of CASES) for (let i = 0; i < (mix[c.id] ?? 0); i++) queue.push(c);
    for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(roll() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
    for (const c of queue) {
      const full = liveDrops(c, { nftInStock: Object.keys(NFT_DROPS[c.id] ?? {}) });
      const drops = bankFilter(c, full, { balance: bank, bigToday: big }, rules);
      if (drops.length !== full.length) filtered++;
      const p = pick(drops, roll());
      bank += c.price - p.value;
      if (isBigPrize(p.value, c.price, rules.bigMin)) big++;
      opens++;
      if (bank < 0) negatives++;
      min = Math.min(min, bank);
    }
  }
  worstMin = Math.min(worstMin, min);
  finals.push(bank);
}
finals.sort((a, b) => a - b);
console.log(`   worst bank low: ${worstMin}⭐ · negative moments: ${negatives} · final bank median ${finals[Math.floor(RUNS / 2)]}⭐ (min ${finals[0]}, max ${finals[RUNS - 1]}) · opens with a protective filter: ${pct(filtered / opens)}`);
if (negatives > 0 || worstMin < 0) { fail = true; console.log('  ✗ bank went negative'); }
if (finals[0] <= START) { fail = true; console.log('  ✗ a run ended with less than the starting bank'); }

if (fail) { console.log('\nFAIL'); process.exit(1); }
console.log('\nOK: every paid case 85–88% (base, with NFT stock, with max luck); NFT only where price < value ≤ 10×; daily EV ≤ 4⭐; bank never negative and grows.');
