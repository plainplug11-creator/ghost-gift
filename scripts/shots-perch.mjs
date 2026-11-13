// Ghost-on-branch QA: case header + every emotion during openings, 390x844 & 360x780.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4173/ghost-gift/';
const OUT = new URL('../shots/perch/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--force-color-profile=srgb'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const talk = process.env.TALK === '0' ? '' : '&talk=1';
async function page(w, hh, q) {
  const ctx = await browser.newContext({ viewport: { width: w, height: hh }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'ru-RU' });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${w} ${q}] ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`[${w} ${q}] ${e.message}`));
  await p.goto(BASE + q, { waitUntil: 'networkidle' });
  return { p, ctx };
}
const lang = process.env.LANGQ ? `&lang=${process.env.LANGQ}` : '';
for (const [w, hh] of [[390, 844], [360, 780]]) {
  { const { p, ctx } = await page(w, hh, `?tier=high&push=case:neon${lang}`); await sleep(1500); await p.screenshot({ path: `${OUT}${w}-case-header.png` }); await ctx.close(); }
  for (const [force, cs, tag] of [['rose', 'neon', 'rare'], ['cup', 'ghost', 'legendary'], ['heart', 'neon', 'common']]) {
    let tries = 0;
    for (;;) {
      const { p, ctx } = await page(w, hh, `?tier=high&push=case:${cs}&autoopen=1&force=${force}${talk}${lang}`);
      await p.waitForSelector('.op.is-in', { timeout: 10000 }); await sleep(600);
      await p.screenshot({ path: `${OUT}${w}-${tag}-1-charge.png` });
      await p.waitForSelector('.op.is-reel', { timeout: 10000 }); await sleep(700);
      await p.screenshot({ path: `${OUT}${w}-${tag}-2-spin.png` });
      await p.waitForSelector('.perch[data-mood="lean"]', { timeout: 12000 }); await sleep(450);
      await p.screenshot({ path: `${OUT}${w}-${tag}-3-lean.png` });
      await p.waitForSelector('.op.is-settled', { timeout: 12000 }); await sleep(420);
      const near = await p.$('.op.is-nearmiss');
      const mood = await p.$eval('.op-perch', (e) => e.dataset.mood);
      await p.screenshot({ path: `${OUT}${w}-${tag}-4-land-${mood}.png` });
      await p.waitForSelector('.op.is-reveal', { timeout: 10000 }); await sleep(500);
      const mood2 = await p.$eval('.op-perch', (e) => e.dataset.mood);
      await p.screenshot({ path: `${OUT}${w}-${tag}-5-reveal-${mood2}.png` });
      console.log(w, tag, 'land mood', mood, 'reveal mood', mood2, near ? 'NEAR-MISS' : '');
      await ctx.close();
      if (tag !== 'common' || near || ++tries > 6) break; // want a near-miss sample for the gasp
    }
  }
}
console.log('errors', errors.length ? errors : 'none');
await browser.close();
