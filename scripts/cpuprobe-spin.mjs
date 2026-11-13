import { chromium } from 'playwright';
const BASE = 'http://localhost:4173/ghost-gift/';
const b = await chromium.launch();
async function run(name, css) {
  const r = [];
  for (let k = 0; k < 2; k++) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
    const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
    await cdp.send('Performance.enable'); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    if (css) await p.addInitScript((c) => addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = c; document.head.append(s); }), css);
    await p.goto(BASE + '?tier=high&push=case:ghost&autoopen=1&force=cup', { waitUntil: 'load' });
    await p.waitForSelector('.op.is-reel', { timeout: 20000 });
    const met = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const a = await met(); await p.waitForTimeout(3500); const c = await met(); const s = c.Timestamp - a.Timestamp;
    r.push([Math.round((c.TaskDuration - a.TaskDuration) / s * 100), Math.round(((c.RecalcStyleDuration - a.RecalcStyleDuration) + (c.LayoutDuration - a.LayoutDuration)) * 1000 / s), Math.round((c.ScriptDuration - a.ScriptDuration) * 1000 / s), Math.round((c.LayoutCount - a.LayoutCount) / s)]);
    await ctx.close();
  }
  console.log(name.padEnd(18), JSON.stringify(r), '[cpu%, style+layout ms/s, script ms/s, layouts/s]');
}
const only = process.argv[2];
const T = {
  baseline: '',
  'no css anim': '*,*::before,*::after{animation:none!important}',
  'no perch': '.op-perch{display:none!important}',
  'no case page': '.cd-hero,.cd-sec,.pg-scroll > *:not(.op){display:none!important}',
  'no canvas': '#ambience{display:none!important}',
  'no deck': '.op-deck{display:none!important}',
  'deck static': '.op-deck *{animation:none!important}',
  'no beams': '.dk-beam{display:none!important}',
  'no blur row': '.op-blur{display:none!important}',
  'no lens/track': '.op-lens,.op-track{display:none!important}',
};
for (const [k, v] of Object.entries(T)) if (!only || k === only) await run(k, v);
await b.close();
