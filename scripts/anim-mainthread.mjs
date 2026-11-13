// For each running animation name: play only that group, count main-thread style recalcs → finds non-composited animations.
import { chromium } from 'playwright';
const BASE = 'http://localhost:4173/ghost-gift/';
const b = await chromium.launch();
const q = process.argv[2] || '?tier=high';
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p); await cdp.send('Performance.enable');
await p.goto(BASE + q, { waitUntil: 'load' }); await p.waitForTimeout(3500);
const names = await p.evaluate(() => { window.__A = document.getAnimations().filter((a) => a.playState === 'running'); return [...new Set(window.__A.map((a) => a.animationName || ('waapi:' + (a.effect.target.className?.baseVal ?? a.effect.target.className))))]; });
const m = async () => (await cdp.send('Performance.getMetrics')).metrics.find((x) => x.name === 'RecalcStyleCount').value;
await p.evaluate(() => window.__A.forEach((a) => a.pause()));
await p.waitForTimeout(300); let a0 = await m(); await p.waitForTimeout(1000); console.log('all paused', (await m()) - a0);
for (const n of names) {
  await p.evaluate((n) => window.__A.forEach((a) => ((a.animationName || ('waapi:' + (a.effect.target.className?.baseVal ?? a.effect.target.className))) === n ? a.play() : a.pause())), n);
  await p.waitForTimeout(300); a0 = await m(); await p.waitForTimeout(1000); const r = (await m()) - a0;
  if (r > 5) console.log(String(r).padStart(4), n);
}
await b.close();
