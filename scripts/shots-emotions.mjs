// Emotion sheet for the layered mascot: big ghost on the case header, every mood on the visor eyes / star.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4173/ghost-gift/';
const OUT = process.argv[2] || '/tmp/emo/'; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ args: ['--force-color-profile=srgb'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, colorScheme: 'dark', locale: 'ru-RU' });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(BASE + '?tier=high&push=case:ghost', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
await p.addStyleTag({ content: '.cd-hero .perch{--pm:250px!important;--gpos:.5!important;z-index:5!important} .cd-hero .perch .pc-bough{opacity:.35} .cd-float,.cd-rays,.cd-tw{opacity:0!important} .ge-lid{animation:none!important}' });
await p.waitForTimeout(600);
const look = { idle: [-6, 5], watch: [-8, 8], lean: [-9, 9], gasp: [-6, 4], meh: [-2, 3], happy: [-3, 2], ecstatic: [0, -2] };
for (const m of Object.keys(look)) {
  await p.evaluate(([m, x, y]) => { const g = document.querySelector('.pc-ghost .gh'); g.dataset.mood = m; document.querySelector('.pc-ghost .ge-look').style.transform = `translate(${x * 2.3}px,${y * 2.3}px)`; }, [m, ...look[m]]);
  await p.waitForTimeout(700);
  const r = await p.locator('.pc-ghost').boundingBox();
  await p.screenshot({ path: `${OUT}${m}.png`, clip: { x: r.x - 20, y: r.y - 20, width: r.width + 40, height: r.height + 40 } });
}
console.log('errors', errs.length ? errs : 'none');
await b.close();
