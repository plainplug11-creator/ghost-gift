// QA for stage 2 (cases): screenshots 390x844 + console errors + reel frame timing.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4173/';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--force-color-profile=srgb', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'ru-RU' });
async function open(q) {
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${q}] ${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`[${q}] pageerror: ${e.message}`));
  await p.goto(BASE + q, { waitUntil: 'networkidle' });
  return p;
}
const only = process.argv[2];
const run = async (name, fn) => { if (!only || only.split(',').some((o) => name.includes(o))) { await fn(); console.log('ok', name); } };

await run('main', async () => {
  const p = await open('?tier=high');
  await sleep(150); await p.screenshot({ path: OUT + 'c-main-enter.png' });
  await sleep(2000); await p.screenshot({ path: OUT + 'c-main.png' });
  await p.close();
});
await run('grid', async () => {
  const p = await open('?tier=high&push=cases'); await sleep(1600);
  await p.screenshot({ path: OUT + 'c-cases-grid.png' }); await p.close();
});
await run('detail', async () => {
  const p = await open('?tier=high&push=case:star'); await sleep(1600);
  await p.screenshot({ path: OUT + 'c-case-detail.png' });
  await p.screenshot({ path: OUT + 'c-case-detail-full.png', fullPage: false });
  await p.$eval('.pg-case .pg-scroll', (e) => e.scrollTo(0, 420)); await sleep(500);
  await p.screenshot({ path: OUT + 'c-case-detail-list.png' });
  await p.close();
});
async function opening(force, tag, caseId = 'neon') {
  const p = await open(`?tier=high&push=case:${caseId}&autoopen=1&force=${force}`);
  // frame timing probe
  await p.evaluate(() => { window.__ft = []; let l = performance.now(); const f = (n) => { window.__ft.push(n - l); l = n; requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await p.waitForSelector('.op.is-in', { timeout: 8000 });
  await sleep(700); await p.screenshot({ path: OUT + `c-${tag}-charge.png` });
  await p.waitForSelector('.op.is-reel', { timeout: 8000 });
  await sleep(1300); await p.screenshot({ path: OUT + `c-${tag}-midreel.png` });
  await p.waitForSelector('.op.is-settled', { timeout: 15000 });
  await sleep(300); await p.screenshot({ path: OUT + `c-${tag}-settle.png` });
  await p.waitForSelector('.op.is-reveal', { timeout: 8000 });
  await sleep(700); await p.screenshot({ path: OUT + `c-${tag}-reveal.png` });
  await p.waitForSelector('.bs.is-open', { timeout: 8000 });
  await sleep(800); await p.screenshot({ path: OUT + `c-${tag}-result.png` });
  const ft = await p.evaluate(() => window.__ft.slice(5));
  const slow = ft.filter((x) => x > 25).length;
  console.log(tag, 'frames', ft.length, 'avg ms', (ft.reduce((a, b) => a + b, 0) / ft.length).toFixed(1), '>25ms:', slow, 'max', Math.max(...ft).toFixed(0));
  return p;
}
await run('rare', async () => { const p = await opening('rose', 'rare'); await p.close(); });
await run('legend', async () => { const p = await opening('cup', 'legendary', 'ghost'); await p.close(); });
await run('mythic', async () => {
  const p = await opening('prem3', 'mythic', 'diamond');
  await p.click('.rs-actions .btn-primary'); await sleep(900);
  await p.close();
});
await run('inventory', async () => {
  const p = await open('?tier=high&push=inventory'); await sleep(1500);
  if (!(await p.$('.inv-it'))) { await p.screenshot({ path: OUT + 'c-inventory-empty.png' }); await p.close(); return; }
  await p.screenshot({ path: OUT + 'c-inventory.png' });
  await p.click('.inv-it'); await sleep(900);
  await p.screenshot({ path: OUT + 'c-inventory-item.png' });
  await p.close();
});
await run('profile', async () => {
  const p = await open('?tier=high&tab=profile'); await sleep(1500);
  await p.screenshot({ path: OUT + 'c-profile.png' }); await p.close();
});
await run('en', async () => {
  const p = await open('?tier=high&lang=en&push=case:autumn'); await sleep(1500);
  await p.screenshot({ path: OUT + 'c-en-detail.png' }); await p.close();
});
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
