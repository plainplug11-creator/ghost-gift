import { chromium } from 'playwright';
const b = await chromium.launch();
const cases = {
  plain: '@keyframes a{to{transform:translateX(100px)}} i{animation:a 1s infinite alternate}',
  var: '@keyframes a{to{transform:translateX(var(--d))}} i{--d:100px;animation:a 1s infinite alternate}',
  translateProp: '@keyframes a{to{transform:translateX(100px)}} i{translate:-50% -50%;animation:a 1s infinite alternate}',
  opacityVar: '@keyframes a{to{opacity:var(--o)}} i{--o:.2;animation:a 1s infinite alternate}',
  rafOnly: '',
};
for (const [k, css] of Object.entries(cases)) {
  const p = await b.newPage(); const cdp = await p.context().newCDPSession(p); await cdp.send('Performance.enable');
  await p.setContent(`<style>${css} i{display:block;position:absolute;width:10px;height:10px;background:red}</style>${'<i></i>'.repeat(100)}<div>${'<p>x</p>'.repeat(300)}</div>`);
  await p.waitForTimeout(500);
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const a = await m(); await p.waitForTimeout(2000); const c = await m();
  console.log(k.padEnd(14), 'recalcs', c.RecalcStyleCount - a.RecalcStyleCount, 'styleMs', Math.round((c.RecalcStyleDuration - a.RecalcStyleDuration) * 1000));
  await p.close();
}
await b.close();
