// every case screen + an NFT/premium inventory, for theme review
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = (process.argv[2] || '/tmp/qa-themes') + '/'; mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4173/ghost-gift/';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'ru-RU' });
const now = Date.now();
await ctx.addInitScript((s) => { localStorage.setItem('gg.mock.v1', s); localStorage.setItem('gg.review', '["u1"]'); }, JSON.stringify({ balance: 9000, nonce: 1, clientSeed: 'a1b2c3d4e5f60718', serverSeed: 'f'.repeat(64), stats: { opens: 1, wins: 0, best: 0 },
  inv: [['prem12', 'king'], ['prem6', 'phantom'], ['stars2500', 'aurora'], ['cup', 'spark']].map(([prizeId, caseId], i) => ({ uid: 'u' + i, prizeId, caseId, wonAt: now - i * 6e5, status: i === 1 ? 'withdrawing' : 'owned' })) }));
const errs = [];
for (const id of ['daily', 'spark', 'lantern', 'autumn', 'neon', 'ghost', 'star', 'diamond', 'legend', 'aurora', 'phantom', 'king']) {
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(id + ' ' + e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(id + ' ' + m.text()));
  await p.goto(BASE + `?tier=high&push=${id === 'daily' ? 'daily' : 'case:' + id}`); await p.waitForTimeout(1500); await p.screenshot({ path: OUT + id + '.png' }); await p.close();
}
for (const [n, q] of [['inv', '?tier=high&push=inventory'], ['topup', '?tier=high&push=topup'], ['cases', '?tier=high&push=cases']]) {
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(n + ' ' + e.message));
  await p.goto(BASE + q); await p.waitForTimeout(1500); await p.screenshot({ path: OUT + n + '.png' });
  if (n === 'inv') { await p.click('.inv-item >> nth=1').catch(() => {}); await p.waitForTimeout(900); await p.screenshot({ path: OUT + 'inv-review.png' }); }
  if (n === 'topup') { await p.click('.tu-pack >> nth=2').catch((e) => errs.push('tap ' + e.message)); await p.waitForTimeout(1500); await p.screenshot({ path: OUT + 'topup-after.png' }); }
  await p.close();
}
console.log('errors:', errs.length ? errs : 'none'); await b.close();
