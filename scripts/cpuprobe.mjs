import { chromium } from 'playwright';
const BASE = 'http://localhost:4173/ghost-gift/';
const b = await chromium.launch({ args: (process.env.GPU ? ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-gpu-rasterization'] : []) });
const q = process.argv[2] || '?tier=high';
async function run(name, css, init) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable'); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  if (init) await p.addInitScript(init);
  await p.goto(BASE + q, { waitUntil: 'load' }); await p.waitForTimeout(3500);
  if (css) await p.addStyleTag({ content: css });
  await p.waitForTimeout(500);
  const met = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const a = await met(); await p.waitForTimeout(3000); const c = await met(); const s = c.Timestamp - a.Timestamp;
  console.log(name.padEnd(22), 'cpu%', Math.round((c.TaskDuration - a.TaskDuration) / s * 100), 'style+layout ms/s', Math.round(((c.RecalcStyleDuration - a.RecalcStyleDuration) + (c.LayoutDuration - a.LayoutDuration)) * 1000 / s), 'script', Math.round((c.ScriptDuration - a.ScriptDuration) * 1000 / s), 'recalcs/s', Math.round((c.RecalcStyleCount - a.RecalcStyleCount) / s), 'layouts/s', Math.round((c.LayoutCount - a.LayoutCount) / s));
  await ctx.close();
}
const NA='{animation:none!important}';
for (let k = 0; k < (+process.env.N || 1); k++) await run('baseline');
await b.close();
