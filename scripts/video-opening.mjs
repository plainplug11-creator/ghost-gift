// Records a full case opening at full DPR via CDP screencast → shots/video-tmp/<tag>/ frames + ffconcat.
// (Playwright recordVideo ignores deviceScaleFactor and leaves the page in the top-left quarter.)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4173/ghost-gift/';
const OUT = new URL('../shots/', import.meta.url).pathname;
const force = process.argv[2] || 'cup', caseId = process.argv[3] || 'ghost', tag = process.argv[4] || 'legendary';
const dir = `${OUT}video-tmp/${tag}/`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--force-device-scale-factor=2', '--enable-gpu-rasterization', '--force-color-profile=srgb', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'ru-RU' });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(`${BASE}?tier=high&push=case:${caseId}&force=${force}${process.env.TALK ? "&talk=1" : ""}`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const cdp = await ctx.newCDPSession(p);
const frames = [];
cdp.on('Page.screencastFrame', async (f) => {
  const i = frames.length; writeFileSync(`${dir}${String(i).padStart(5, '0')}.jpg`, Buffer.from(f.data, 'base64'));
  frames.push(f.metadata.timestamp);
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
await p.waitForTimeout(500);
await p.tap('.cd-open');
await p.waitForSelector('.bs.is-open', { timeout: 20000 });
await p.waitForTimeout(2200);
await p.tap('.rs-actions .btn-primary');
await p.waitForTimeout(1200);
await cdp.send('Page.stopScreencast');
await new Promise((r) => setTimeout(r, 300));
// ffconcat with real frame durations
let s = 'ffconcat version 1.0\n';
for (let i = 0; i < frames.length; i++) { s += `file ${String(i).padStart(5, '0')}.jpg\n`; s += `duration ${Math.max(0.001, ((frames[i + 1] ?? frames[i] + 0.033) - frames[i])).toFixed(4)}\n`; }
s += `file ${String(frames.length - 1).padStart(5, '0')}.jpg\n`;
writeFileSync(`${dir}list.txt`, s);
console.log('frames', frames.length, 'secs', (frames.at(-1) - frames[0]).toFixed(1), 'dir', dir, 'errors', errs.length ? errs : 'none');
await browser.close();
