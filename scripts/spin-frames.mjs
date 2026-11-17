// Frame times during the case-opening reel (no screenshots while measuring).
// usage: node scripts/spin-frames.mjs [BASE] [runs] [cpuThrottle]
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:4173/ghost-gift/';
const RUNS = Number(process.argv[3] || 3);
const THROTTLE = Number(process.argv[4] || 4);
const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' });
await ctx.addInitScript(() => localStorage.setItem('gg.mock.v1', JSON.stringify({ balance: 99999, inv: [], nonce: 1, clientSeed: 'ab', serverSeed: 'f'.repeat(64), stats: { opens: 0, wins: 0, best: 0 } })));
const all = [];
for (let r = 0; r < RUNS; r++) {
  for (const [c, f] of [['neon', 'rose'], ['king', 'nft_scaredcat']]) {
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    await p.goto(`${BASE}?tier=high&push=case:${c}&autoopen=1&force=${f}`, { waitUntil: 'load' });
    await p.waitForSelector('.op.is-reel', { timeout: 20000 });
    const ts = await p.evaluate(() => new Promise((res) => {
      const out = []; let last = performance.now();
      const op = document.querySelector('.op');
      const f = (t) => { out.push(t - last); last = t; if (!op.classList.contains('is-landed')) requestAnimationFrame(f); else res(out); };
      requestAnimationFrame(f);
    }));
    all.push(...ts.slice(2));
    await p.close();
  }
}
const s = [...all].sort((a, b) => a - b);
const q = (x) => s[Math.min(s.length - 1, Math.floor(s.length * x))].toFixed(1);
console.log(JSON.stringify({ throttle: THROTTLE, frames: all.length, avg: (all.reduce((a, b) => a + b, 0) / all.length).toFixed(2), p50: q(0.5), p90: q(0.9), p95: q(0.95), p99: q(0.99), max: s[s.length - 1].toFixed(1), janky_over_25ms: all.filter((x) => x > 25).length, over_50ms: all.filter((x) => x > 50).length }));
await browser.close();
