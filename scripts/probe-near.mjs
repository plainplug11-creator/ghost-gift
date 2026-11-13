import { chromium } from 'playwright';
const b = await chromium.launch(); 
for (let k = 0; k < 8; k++) {
  const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto('http://localhost:4173/ghost-gift/?tier=high&push=case:neon&autoopen=1&force=heart', { waitUntil: 'networkidle' });
  await p.waitForSelector('.op.is-settled', { timeout: 15000 });
  if (!(await p.$('.op.is-nearmiss'))) { await new Promise(r => setTimeout(r, 200)); }
  const near = await p.$('.op.is-nearmiss');
  if (!near) { await ctx.close(); continue; }
  for (let i = 0; i < 10; i++) { await p.screenshot({ path: `/tmp/near-${i}.png` }); await new Promise(r => setTimeout(r, 120)); }
  console.log('captured');
  await ctx.close(); break;
}
await b.close();
