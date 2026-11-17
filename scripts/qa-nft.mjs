// QA for NFT prizes + spin: iPhone-viewport screenshots and frame times during a spin.
// usage: node scripts/qa-nft.mjs [outDir] [BASE]   (needs `npm run build && npm run preview`)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = (process.argv[2] || '/tmp/qa-nft').replace(/\/?$/, '/');
const BASE = process.argv[3] || 'http://localhost:4173/ghost-gift/';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--force-color-profile=srgb', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = Date.now();
const seed = JSON.stringify({ balance: 25000, nonce: 3, clientSeed: 'a1b2c3d4e5f60718', serverSeed: 'f'.repeat(64), stats: { opens: 42, wins: 17, best: 8 },
  inv: [['nft_witchhat', 'ghost', 'withdrawing'], ['nft_pumpkin', 'star', 'owned'], ['prem3', 'diamond', 'owned'], ['cup', 'ghost', 'owned'], ['rose', 'neon', 'owned']]
    .map(([prizeId, caseId, status], i) => ({ uid: 'u' + i, prizeId, caseId, wonAt: now - i * 6e5, status })) });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'ru-RU',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' });
await ctx.addInitScript((s) => { localStorage.setItem('gg.mock.v1', s); }, seed);
async function open(q, wait = 1600) {
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${q}] ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`[${q}] pageerror: ${e.message}`));
  await p.goto(BASE + q, { waitUntil: 'load' });
  await sleep(wait);
  return p;
}
const shot = (p, n) => p.screenshot({ path: OUT + n + '.png' });
const only = process.argv[4];
const run = async (name, fn) => { if (only && !only.split(',').some((o) => name.includes(o))) return; try { await fn(); console.log('ok', name); } catch (e) { console.log('FAIL', name, e.message); errors.push(`[${name}] ${e.message}`); } };
const frames = {};

await run('01-home', async () => { const p = await open('?tier=high', 2500); await shot(p, '01-home'); await p.close(); });
await run('02-grid', async () => { const p = await open('?tier=high&push=cases'); await shot(p, '02-grid'); await p.$eval('.pg-scroll', (e) => e.scrollTo(0, 700)).catch(() => {}); await sleep(500); await shot(p, '02b-grid-scrolled'); await p.close(); });
await run('03-case-king', async () => {
  const p = await open('?tier=high&push=case:king', 2200); await shot(p, '03-case-king');
  await p.$eval('.pg-case .pg-scroll', (e) => e.scrollTo(0, 640)); await sleep(1200); await shot(p, '03b-king-contents'); await p.close();
});
await run('03c-case-ghost', async () => { const p = await open('?tier=high&push=case:ghost', 2000); await p.$eval('.pg-case .pg-scroll', (e) => e.scrollTo(0, 640)); await sleep(1200); await shot(p, '03c-ghost-contents'); await p.close(); });
async function opening(force, caseId, tag, measure = false) {
  const p = await open(`?tier=high&push=case:${caseId}&autoopen=1&force=${force}`, 200);
  if (measure) {
    await p.evaluate(() => { const ts = []; window.__ft = ts; let last = performance.now(); const f = (t) => { ts.push(t - last); last = t; if (ts.length < 1200) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  }
  await p.waitForSelector('.op.is-reel', { timeout: 10000 }); await sleep(900); await shot(p, `05-${tag}-spin-mid`);
  await sleep(900); await shot(p, `05b-${tag}-spin-slow`);
  await p.waitForSelector('.op.is-reveal', { timeout: 20000 }); await sleep(800); await shot(p, `06-${tag}-win`);
  await p.waitForSelector('.bs.is-open', { timeout: 15000 }); await sleep(900); await shot(p, `07-${tag}-result`);
  if (measure) {
    const ts = await p.evaluate(() => window.__ft.slice(5));
    const s = [...ts].sort((a, b) => a - b);
    const q = (x) => s[Math.min(s.length - 1, Math.floor(s.length * x))].toFixed(1);
    frames[tag] = { frames: ts.length, avg: (ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(2), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1].toFixed(1), over33: ts.filter((x) => x > 33.4).length, over50: ts.filter((x) => x > 50).length };
  }
  await p.close();
}
await run('nft-king', () => opening('nft_scaredcat', 'king', 'nft-king', true));
await run('nft-ghost', () => opening('nft_witchhat', 'ghost', 'nft-ghost'));
await run('rare-neon', () => opening('rose', 'neon', 'rare-neon', true));
await run('prem', () => opening('prem3', 'diamond', 'premium'));
await run('10-inventory', async () => { const p = await open('?tier=high&push=inventory'); await shot(p, '10-inventory'); await p.click('.inv-it'); await sleep(900); await shot(p, '11-nft-sending'); await p.close(); });
await run('12-inv-nft', async () => { const p = await open('?tier=high&push=inventory'); const its = await p.$$('.inv-it'); await its[1].click(); await sleep(900); await shot(p, '12-nft-claim'); await p.close(); });
writeFileSync(OUT + 'frames.json', JSON.stringify(frames, null, 2));
writeFileSync(OUT + 'console-errors.txt', errors.join('\n') || 'none');
console.log('frames', JSON.stringify(frames));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
