// Deterministic screenshots for before/after visual comparison: all animations frozen at t=1s, canvas/video hidden.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4173/ghost-gift/';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ args: ['--force-color-profile=srgb'] });
for (const [name, q] of [['home', '?tier=high'], ['case', '?tier=high&push=case:ghost'], ['profile', '?tier=high&tab=profile'], ['home-low', '?tier=low']]) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, colorScheme: 'dark', locale: 'ru-RU' });
  const p = await ctx.newPage();
  await p.addInitScript(() => { Math.random = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })(); });
  await p.goto(BASE + q, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
  await p.addStyleTag({ content: '#ambience,#ambience-css,.bg-video,.feed,[class*=feed]{visibility:hidden!important} *,*::before,*::after{transition:none!important;caret-color:transparent!important}' });
  await p.evaluate(() => document.getAnimations().forEach((a) => { try { a.pause(); a.currentTime = 1000; } catch {} }));
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}${name}.png` });
  await ctx.close();
}
await b.close();
