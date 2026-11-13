import { chromium } from 'playwright';
const BASE = 'http://localhost:4173/ghost-gift/';
const b = await chromium.launch();
const q = process.argv[2] || '?tier=high';
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
const p = await ctx.newPage();
await p.goto(BASE + q, { waitUntil: 'load' }); await p.waitForTimeout(4000);
await b.startTracing(p, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'blink.animations'] });
await p.waitForTimeout(2000);
const ev = JSON.parse((await b.stopTracing()).toString()).traceEvents;
const c = {}; for (const e of ev) c[e.name] = (c[e.name] || 0) + 1;
console.log(Object.entries(c).filter(([k]) => /Animation|Frame|Style|Layout|Paint|Timer|Invalidat|Schedule/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${v} ${k}`).join('\n'));
const inv = ev.filter((e) => e.name === 'StyleRecalcInvalidationTracking' || e.name === 'StyleInvalidatorInvalidationTracking' || e.name === 'ScheduleStyleInvalidationTracking');
const r = {}; for (const e of inv) { const d = e.args?.data || {}; const k = `${e.name} ${d.reason || ''} ${d.nodeName || ''} ${d.extraData || ''}`; r[k] = (r[k] || 0) + 1; }
console.log(Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${v} ${k}`).join('\n'));
await b.close();
