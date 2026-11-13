import { chromium } from 'playwright';
const b = await chromium.launch(process.env.GPU ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] } : {});
for (const n of [0, 1, 200]) {
  const p = await b.newPage(); const cdp = await p.context().newCDPSession(p); await cdp.send('Performance.enable');
  await p.setContent(`<style>@keyframes a{to{transform:translateX(100px) rotate(30deg)}} i{display:block;width:10px;height:10px;background:red;animation:a 1s infinite alternate}</style>${'<i></i>'.repeat(n)}<script>(function f(){requestAnimationFrame(f)})()</script><div>${'<p>x</p>'.repeat(500)}</div>`);
  await p.waitForTimeout(500);
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const a = await m(); await p.waitForTimeout(2000); const c = await m();
  console.log(n, 'anims: recalcs', c.RecalcStyleCount - a.RecalcStyleCount, 'styleMs', Math.round((c.RecalcStyleDuration - a.RecalcStyleDuration) * 1000), 'task', Math.round((c.TaskDuration - a.TaskDuration) * 1000));
  await p.close();
}
await b.close();
