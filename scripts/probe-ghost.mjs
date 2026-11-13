// quick look: home header logo, case hero, ghost close-up
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4173/ghost-gift/';
const OUT = process.env.OUT || '/tmp/pg/'; mkdirSync(OUT, { recursive: true });
const tier = process.env.TIER || 'high';
const b = await chromium.launch({ args: ['--force-color-profile=srgb'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'ru-RU' });
const errs = [];
const go = async (q) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text())); await p.goto(BASE + q, { waitUntil: 'networkidle' }); return p; };
let p = await go(`?tier=${tier}`); await p.waitForTimeout(1600);
await p.screenshot({ path: OUT + 'home.png' });
await p.screenshot({ path: OUT + 'logo.png', clip: { x: 0, y: 0, width: 200, height: 80 } });
p = await go(`?tier=${tier}&push=case:ghost`); await p.waitForTimeout(1600);
await p.screenshot({ path: OUT + 'case.png' });
const g = await p.locator('.pc-ghost').boundingBox();
await p.screenshot({ path: OUT + 'close.png', clip: { x: g.x - g.width * 0.4, y: g.y - g.height * 0.4, width: g.width * 1.8, height: g.height * 1.8 } });
console.log('ghost box', g, 'errors', errs);
await b.close();
