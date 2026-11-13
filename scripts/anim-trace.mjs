// Trace-based: which animations failed to run on the compositor and why (Chrome "Animation" trace events).
import { chromium } from 'playwright';
const BASE = 'http://localhost:4173/ghost-gift/';
const b = await chromium.launch();
const q = process.argv[2] || '?tier=high';
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
const p = await ctx.newPage();
await b.startTracing(p, { categories: ['devtools.timeline', 'blink.animations', 'cc', 'disabled-by-default-devtools.timeline'] });
await p.goto(BASE + q, { waitUntil: 'load' }); await p.waitForTimeout(4000);
const buf = await b.stopTracing();
const ev = JSON.parse(buf.toString()).traceEvents;
const names = new Map(), fails = new Map();
for (const e of ev) {
  if (e.name !== 'Animation') continue;
  const d = e.args?.data || {};
  if (d.name !== undefined) names.set(e.id2?.local || e.id, d.name);
  if (d.compositeFailed !== undefined && d.compositeFailed) {
    const key = (e.id2?.local || e.id);
    fails.set(key, { code: d.compositeFailed, props: (d.unsupportedProperties || []).join(',') });
  }
}
const agg = {};
for (const [id, f] of fails) { const k = `${names.get(id) || '?'} code=${f.code} ${f.props}`; agg[k] = (agg[k] || 0) + 1; }
console.log(Object.entries(agg).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${String(v).padStart(3)} ${k}`).join('\n') || 'none failed');
await b.close();
