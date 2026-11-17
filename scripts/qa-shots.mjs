// QA: iPhone-viewport screenshots of every key screen + console errors.
// usage: node scripts/qa-shots.mjs <outDir> [BASE] [filter]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = (process.argv[2] || '/workspace/ghost-gift-media/qa/after').replace(/\/?$/, '/');
const BASE = process.argv[3] || 'http://localhost:4173/ghost-gift/';
const only = process.argv[4];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--force-color-profile=srgb', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = Date.now();
const seed = JSON.stringify({ balance: 1250, nonce: 3, clientSeed: 'a1b2c3d4e5f60718', serverSeed: 'f'.repeat(64), stats: { opens: 42, wins: 17, best: 8 },
  inv: [['cup', 'ghost'], ['prem3', 'diamond'], ['rose', 'neon'], ['rocket', 'neon'], ['heart', 'autumn'], ['diamond', 'star']].map(([prizeId, caseId], i) => ({ uid: 'u' + i, prizeId, caseId, wonAt: now - i * 6e5, status: i === 3 ? 'withdrawing' : 'owned' })) });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'ru-RU',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' });
await ctx.addInitScript((s) => { if (!localStorage.getItem('gg.mock.v1')) localStorage.setItem('gg.mock.v1', s); }, seed);
async function open(q, wait = 1600) {
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${q}] ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`[${q}] pageerror: ${e.message}`));
  await p.goto(BASE + q, { waitUntil: 'load' });
  await sleep(wait);
  return p;
}
const shot = (p, n) => p.screenshot({ path: OUT + n + '.png' });
const run = async (name, fn) => { if (!only || only.split(',').some((o) => name.includes(o))) { try { await fn(); console.log('ok', name); } catch (e) { console.log('FAIL', name, e.message); errors.push(`[${name}] ${e.message}`); } } };
const simple = (name, q, wait) => run(name, async () => { const p = await open(q, wait); await shot(p, name); await p.close(); });

await simple('01-home', '?tier=high', 2500);
await simple('02-cases', '?tier=high&push=cases');
await run('03-case', async () => { const p = await open('?tier=high&push=case:star'); await shot(p, '03-case'); await p.$eval('.pg-case .pg-scroll', (e) => e.scrollTo(0, 520)); await sleep(500); await shot(p, '03b-case-odds'); await p.close(); });
await simple('04-daily', '?tier=high&push=daily');
async function opening(force, caseId, tag) {
  const p = await open(`?tier=high&push=case:${caseId}&autoopen=1&force=${force}`, 300);
  await p.waitForSelector('.op.is-reel', { timeout: 10000 }); await sleep(1200); await shot(p, `05-${tag}-reel`);
  await p.waitForSelector('.op.is-reveal', { timeout: 15000 }); await sleep(700); await shot(p, `05-${tag}-reveal`);
  await p.waitForSelector('.bs.is-open', { timeout: 10000 }); await sleep(900); await shot(p, `06-${tag}-result`);
  await p.close();
}
await run('05-rare', () => opening('rose', 'neon', 'rare'));
await run('05-mythic', () => opening('prem3', 'diamond', 'premium'));
await run('05-legend', () => opening('cup', 'ghost', 'legendary'));
await simple('07-wheel', '?tier=high&push=wheel');
await simple('08-slots', '?tier=high&push=slots');
await simple('09-profile', '?tier=high&tab=profile', 2000);
await run('10-inventory', async () => { const p = await open('?tier=high&push=inventory'); await shot(p, '10-inventory'); await p.click('.inv-it'); await sleep(900); await shot(p, '11-withdraw'); await p.close(); });
await simple('12-topup', '?tier=high&push=topup');
await run('13-legal', async () => { const p = await open('?tier=high&push=legal:fair'); await shot(p, '13-fairness'); await p.close(); });
await run('14-terms', async () => { const p = await open('?tier=high&lang=en&push=legal:terms'); await shot(p, '14-terms-en'); await p.close(); });
await simple('15-home-low', '?tier=low', 2000);
await simple('16-home-uk', '?tier=high&lang=uk', 2000);
writeFileSync(OUT + 'console-errors.txt', errors.join('\n') || 'none');
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
