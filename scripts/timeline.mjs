import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto('http://localhost:4173/?tier=high&push=case:ghost&force=cup', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.evaluate(() => {
  window.__tl = []; const t0 = performance.now();
  new MutationObserver(() => { const o = document.querySelector('.op'); if (o) { const c = o.className; if (window.__last !== c) { window.__last = c; window.__tl.push([(performance.now() - t0) | 0, c]); } } if (document.querySelector('.bs.is-open') && !window.__bs) { window.__bs = 1; window.__tl.push([(performance.now() - t0) | 0, 'sheet']); } }).observe(document.body, { subtree: true, attributes: true, childList: true });
});
await p.tap('.cd-open');
await p.waitForSelector('.bs.is-open', { timeout: 30000 });
console.log(await p.evaluate(() => window.__tl));
await b.close();
