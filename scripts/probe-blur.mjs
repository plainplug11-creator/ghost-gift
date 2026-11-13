import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--enable-gpu-rasterization'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto('http://localhost:4173/?tier=high&push=case:neon&autoopen=1&force=rose', { waitUntil: 'networkidle' });
await p.waitForSelector('.op.is-reel');
for (const ms of [120, 500]) {
  await p.waitForTimeout(ms === 120 ? 120 : 380);
  const o = await p.evaluate(() => [document.querySelector('.op-blur')?.style.opacity, document.querySelector('.op-sharp')?.style.opacity, document.querySelector('.op-strip').style.transform]);
  console.log(ms, o);
  await p.screenshot({ path: `/workspace/ghost-gift/shots/c-reel-blur-${ms}.png`, clip: { x: 0, y: 200, width: 390, height: 260 } });
}
await b.close();
