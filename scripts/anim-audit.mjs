// lists running animations that the compositor can't take (SVG targets or non transform/opacity props)
import { chromium } from 'playwright';
const BASE = 'http://localhost:4173/ghost-gift/';
const b = await chromium.launch();
for (const q of ['?tier=high', '?tier=high&push=case:ghost', '?tier=high&push=case:ghost&autoopen=1&force=cup']) {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
  await p.goto(BASE + q, { waitUntil: 'load' }); await p.waitForTimeout(q.includes('autoopen') ? 4000 : 2500);
  const r = await p.evaluate(() => {
    const out = {}; let n = 0;
    for (const a of document.getAnimations()) {
      if (a.playState !== 'running') continue; n++;
      const e = a.effect; const t = e.target; const props = new Set();
      for (const k of e.getKeyframes()) for (const key of Object.keys(k)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(key)) props.add(key);
      const bad = t instanceof SVGElement || [...props].some((x) => x !== 'transform' && x !== 'opacity');
      if (!bad) continue;
      const id = `${t.tagName.toLowerCase()}.${(t.getAttribute('class') || '').split(' ').join('.')} [${[...props].join(',')}] ${a.animationName || ''}`;
      out[id] = (out[id] || 0) + 1;
    }
    return { running: n, bad: out };
  });
  console.log(q, JSON.stringify(r, null, 1));
}
await b.close();
