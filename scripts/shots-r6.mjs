// Home / case page / win (reveal + result sheet) screenshots at 390x844 + 360x780 (+ low tier).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4173/ghost-gift/';
const OUT = new URL('../shots/r6/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--force-color-profile=srgb'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [w, hh, tier] of [[390, 844, 'high'], [360, 780, 'high'], [360, 780, 'low']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: hh }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'ru-RU' });
  const go = async (q) => { const p = await ctx.newPage(); p.on('console', (m) => m.type() === 'error' && errors.push(`[${w}${tier} ${q}] ${m.text()}`)); p.on('pageerror', (e) => errors.push(`[${w}${tier} ${q}] ${e.message}`)); await p.goto(BASE + q, { waitUntil: 'networkidle' }); return p; };
  const tag = `${w}-${tier}`;
  let p = await go(`?tier=${tier}`); await sleep(1800); await p.screenshot({ path: `${OUT}${tag}-home.png` }); await p.close();
  p = await go(`?tier=${tier}&push=case:ghost`); await sleep(1800); await p.screenshot({ path: `${OUT}${tag}-case.png` }); await p.close();
  for (const [force, cs, t2] of [['cup', 'ghost', 'legendary'], ['rose', 'neon', 'rare']]) {
    p = await go(`?tier=${tier}&push=case:${cs}&autoopen=1&force=${force}&talk=1`);
    await p.waitForSelector('.op.is-reel', { timeout: 10000 }); await sleep(1500); await p.screenshot({ path: `${OUT}${tag}-${t2}-midspin.png` });
    await p.waitForSelector('.op.is-reveal', { timeout: 15000 }); await sleep(1100); await p.screenshot({ path: `${OUT}${tag}-${t2}-win.png` });
    await p.waitForSelector('.bs.is-open', { timeout: 10000 }); await sleep(900); await p.screenshot({ path: `${OUT}${tag}-${t2}-result.png` });
    await p.close();
  }
  await ctx.close();
}
console.log('errors', errors.length ? errors : 'none');
await browser.close();
