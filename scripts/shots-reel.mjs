// Reel QA: mid-spin screenshots at 390x844 and 360x780 (high + low tier), console errors, frame timing.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4173/ghost-gift/';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--force-color-profile=srgb', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [w, hgt] of [[390, 844], [360, 780]]) {
  for (const [tier, force, cs, tag] of [['high', 'rose', 'neon', 'rare'], ['high', 'cup', 'ghost', 'legendary'], ['low', 'rose', 'neon', 'rare-low']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'ru-RU' });
    const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${w} ${tag}] ${m.text()}`); });
    p.on('pageerror', (e) => errors.push(`[${w} ${tag}] pageerror: ${e.message}`));
    await p.goto(`${BASE}?tier=${tier}&push=case:${cs}&autoopen=1&force=${force}`, { waitUntil: 'networkidle' });
    await p.evaluate(() => { window.__ft = []; let l = performance.now(); const f = (n) => { window.__ft.push(n - l); l = n; requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await p.waitForSelector('.op.is-reel', { timeout: 10000 });
    const pre = `${OUT}reel-${w}-${tag}`;
    await sleep(600); await p.screenshot({ path: `${pre}-fast.png` });
    if (tier === 'high') { await sleep(1700); await p.screenshot({ path: `${pre}-mid.png` }); await sleep(1500); await p.screenshot({ path: `${pre}-slow.png` }); }
    await p.waitForSelector('.op.is-settled', { timeout: 15000 });
    await sleep(350); await p.screenshot({ path: `${pre}-land.png` });
    const tile = await p.evaluate(() => getComputedStyle(document.querySelector('.op')).getPropertyValue('--tile'));
    const ft = await p.evaluate(() => window.__ft.slice(5));
    console.log(w, tag, 'tile', tile, 'avg', (ft.reduce((a, b) => a + b, 0) / ft.length).toFixed(1), '>25ms', ft.filter((x) => x > 25).length, 'max', Math.max(...ft).toFixed(0));
    await ctx.close();
  }
}
console.log('errors', errors.length ? errors : 'none');
await browser.close();
