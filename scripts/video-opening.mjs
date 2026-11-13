// Records a full case opening (Playwright video) → shots/opening-*.webm
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:4173/';
const OUT = new URL('../shots/', import.meta.url).pathname;
const force = process.argv[2] || 'cup', caseId = process.argv[3] || 'ghost', tag = process.argv[4] || 'legendary';
const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--force-color-profile=srgb', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'ru-RU',
  recordVideo: { dir: OUT + 'video-tmp/', size: { width: 780, height: 1688 } } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(`${BASE}?tier=high&push=case:${caseId}&force=${force}`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1800);
await p.tap('.cd-open');
await p.waitForSelector('.bs.is-open', { timeout: 20000 });
await p.waitForTimeout(2200);
await p.tap('.rs-actions .btn-primary');
await p.waitForTimeout(1200);
const v = p.video();
await ctx.close();
const path = await v.path();
console.log('video', path, 'errors', errs.length ? errs : 'none');
await browser.close();
