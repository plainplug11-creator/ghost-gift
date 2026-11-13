// Perf probe: page weight, load timings (throttled), frame stats (idle home, scroll case page, opening spin).
// usage: node scripts/perf.mjs <label>   → prints JSON + writes shots/perf-<label>.json
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4173/ghost-gift/';
const label = process.argv[2] || 'run';
const RUNS = +(process.env.RUNS || 3);
const b = await chromium.launch({ args: ['--force-color-profile=srgb', '--autoplay-policy=no-user-gesture-required'] });
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function session(throttle) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'ru-RU' });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable'); await cdp.send('Performance.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (throttle) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (1024 * 1024) / 8 }); // ~4 Mbps mobile
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  const bytes = { total: 0, byType: {} };
  cdp.on('Network.loadingFinished', (e) => { bytes.total += e.encodedDataLength; });
  const types = new Map();
  cdp.on('Network.responseReceived', (e) => types.set(e.requestId, e.type));
  cdp.on('Network.loadingFinished', (e) => { const t = types.get(e.requestId) || 'Other'; bytes.byType[t] = (bytes.byType[t] || 0) + e.encodedDataLength; });
  await p.addInitScript(() => {
    window.__lcp = 0; window.__lt = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  });
  return { ctx, p, cdp, bytes };
}

async function frames(p, ms, during, cdp) {
  const met = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const m0 = await met();
  await p.evaluate(() => { window.__f = []; window.__lt = []; let last = performance.now(); const tick = (t) => { window.__f.push(t - last); last = t; if (window.__frun) requestAnimationFrame(tick); }; window.__frun = true; requestAnimationFrame(tick); });
  if (during) await during(); else await p.waitForTimeout(ms);
  const m1 = await met(); const secs = m1.Timestamp - m0.Timestamp;
  const busy = { cpuPct: Math.round(((m1.TaskDuration - m0.TaskDuration) / secs) * 100), scriptMs: Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000 / secs), styleLayoutMs: Math.round(((m1.RecalcStyleDuration - m0.RecalcStyleDuration) + (m1.LayoutDuration - m0.LayoutDuration)) * 1000 / secs) };
  const r = await p.evaluate(() => { window.__frun = false; const f = window.__f.slice(2); const tot = f.reduce((a, c) => a + c, 0);
    return { fps: +(f.length / (tot / 1000)).toFixed(1), p95: +[...f].sort((a, c) => a - c)[Math.floor(f.length * 0.95)].toFixed(1), long: f.filter((x) => x > 34).length, frames: f.length, longTasks: window.__lt.length, ltMs: Math.round(window.__lt.reduce((a, c) => a + c, 0)) }; });
  return { ...r, ...busy };
}

const out = { label, load: [], weight: null, idleHome: [], scrollCase: [], spin: [] };
for (let i = 0; i < RUNS; i++) {
  // cold load, throttled
  const s = await session(true);
  const t0 = Date.now();
  await s.p.goto(BASE + '?tier=high', { waitUntil: 'load' });
  const loadWall = Date.now() - t0;
  await s.p.waitForTimeout(4000); // let the lazy bg video / ambience settle
  const nav = await s.p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const fcp = performance.getEntriesByName('first-contentful-paint')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: Math.round(fcp?.startTime || 0), lcp: Math.round(window.__lcp) }; });
  out.load.push({ ...nav, loadWall });
  if (i === 0) out.weight = { totalKB: Math.round(s.bytes.total / 1024), byTypeKB: Object.fromEntries(Object.entries(s.bytes.byType).map(([k, v]) => [k, Math.round(v / 1024)])) };
  // frames: idle home (CPU 4x)
  out.idleHome.push(await frames(s.p, 3000, null, s.cdp));
  // scroll case page
  await s.p.goto(BASE + '?tier=high&push=case:ghost', { waitUntil: 'load' }); await s.p.waitForTimeout(2500);
  out.scrollCase.push(await frames(s.p, 0, async () => {
    for (let k = 0; k < 2; k++) {
      await s.p.evaluate(async () => { const sc = document.querySelector('.pg-scroll') || document.scrollingElement; const H = sc.scrollHeight; for (let y = 0; y < Math.min(H, 1400); y += 22) { sc.scrollTop = y; await new Promise((r) => requestAnimationFrame(r)); } for (let y = Math.min(H, 1400); y > 0; y -= 22) { sc.scrollTop = y; await new Promise((r) => requestAnimationFrame(r)); } });
    }
  }, s.cdp));
  // opening spin
  await s.p.goto(BASE + '?tier=high&push=case:ghost&autoopen=1&force=cup', { waitUntil: 'load' });
  await s.p.waitForSelector('.op.is-reel', { timeout: 20000 });
  out.spin.push(await frames(s.p, 4000, null, s.cdp));
  await s.ctx.close();
}
const summary = {
  label, weight: out.weight,
  load: Object.fromEntries(['fcp', 'lcp', 'dcl', 'load', 'loadWall'].map((k) => [k, med(out.load.map((x) => x[k]))])),
  idleHome: Object.fromEntries(['fps', 'p95', 'long', 'longTasks', 'ltMs', 'cpuPct', 'scriptMs', 'styleLayoutMs'].map((k) => [k, med(out.idleHome.map((x) => x[k]))])),
  scrollCase: Object.fromEntries(['fps', 'p95', 'long', 'longTasks', 'ltMs', 'cpuPct', 'scriptMs', 'styleLayoutMs'].map((k) => [k, med(out.scrollCase.map((x) => x[k]))])),
  spin: Object.fromEntries(['fps', 'p95', 'long', 'longTasks', 'ltMs', 'cpuPct', 'scriptMs', 'styleLayoutMs'].map((k) => [k, med(out.spin.map((x) => x[k]))])),
};
mkdirSync('shots', { recursive: true });
writeFileSync(`shots/perf-${label}.json`, JSON.stringify({ summary, raw: out }, null, 1));
console.log(JSON.stringify(summary, null, 1));
await b.close();
