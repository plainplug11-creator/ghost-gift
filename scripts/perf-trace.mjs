import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/ghost-gift/';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'ru-RU' });
const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
await p.addInitScript(() => localStorage.setItem('gg.onb', '1'));
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await p.goto(BASE + '?tier=high&push=case:ghost&autoopen=1&force=cup', { waitUntil: 'load' });
await p.waitForSelector('.op.is-reel', { timeout: 20000 });
const events = [];
cdp.on('Tracing.dataCollected', (d) => events.push(...d.value));
await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc,viz,gpu', transferMode: 'ReportEvents' });
await p.waitForTimeout(3000);
const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
await cdp.send('Tracing.end'); await done;
const agg = {};
for (const e of events) if (e.ph === 'X' && e.dur) { const k = (e.name) ; agg[k] = (agg[k] || 0) + e.dur / 1000; }
console.log(Object.entries(agg).sort((a, c) => c[1] - a[1]).slice(0, 30).map(([k, v]) => `${v.toFixed(0).padStart(6)}ms ${k}`).join('\n'));
await b.close();
