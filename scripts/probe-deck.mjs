// mid-spin screenshots of the opening (deck under reel) at several sizes/tiers
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4173/ghost-gift/';
const OUT = process.env.OUT || '/tmp/pd/'; mkdirSync(OUT, { recursive: true });
const runs = [['390-high', 390, 844, 'high'], ['360-high', 360, 780, 'high'], ['360-low', 360, 780, 'low']];
const b = await chromium.launch({ args: ['--force-color-profile=srgb'] });
const errs = [];
for (const [name, w, hgt, tier] of runs) {
  const ctx = await b.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'ru-RU' });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(name + ': ' + e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(name + ': ' + m.text()));
  await p.goto(BASE + `?tier=${tier}&push=case:${process.env.CASE || 'neon'}&autoopen=1&force=${process.env.FORCE || 'rose'}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(+(process.env.AT || 4200));
  await p.screenshot({ path: OUT + name + '-spin.png' });
  await p.waitForTimeout(6500);
  await p.screenshot({ path: OUT + name + '-reveal.png' });
  await ctx.close();
}
console.log('errors', errs);
await b.close();
