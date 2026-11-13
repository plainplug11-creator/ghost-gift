// Headless QA: screenshots at 390x844 + 360x780, animation frame diffs, console errors.
// Usage: npm run build && npm run preview (in another shell) && npm run shots
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4173/';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--force-color-profile=srgb'] });
const errors = [];

async function page(w, h, query = '', dpr = 3) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'ru-RU' });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${w}x${h}${query}] ${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`[${w}x${h}${query}] pageerror: ${e.message}`));
  await p.goto(BASE + query, { waitUntil: 'networkidle' });
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// main @390
let p = await page(390, 844, '?tier=high');
await sleep(2200);
await p.screenshot({ path: OUT + 'main-390x844.png' });
await p.screenshot({ path: OUT + 'detail-header.png', clip: { x: 0, y: 0, width: 390, height: 120 } });
await p.screenshot({ path: OUT + 'detail-cards.png', clip: { x: 0, y: 200, width: 390, height: 260 } });

// animation frames (header + feed + grid) — prove things move
const frames = [];
for (let i = 0; i < 4; i++) { frames.push(await p.screenshot({ clip: { x: 0, y: 0, width: 390, height: 844 }, scale: 'css' })); await sleep(450); }
for (let i = 0; i < 4; i++) await import('node:fs').then((fs) => fs.writeFileSync(OUT + `frame-${i}.png`, frames[i]));
const feedX = [];
for (let i = 0; i < 3; i++) { feedX.push(await p.$eval('.feed-track', (e) => e.style.transform)); await sleep(500); }
const mascot = await p.$eval('.mascot-bob', (e) => getComputedStyle(e).transform);
await sleep(300);
const mascot2 = await p.$eval('.mascot-bob', (e) => getComputedStyle(e).transform);
const rotor = await p.$eval('.wh-rotor', (e) => getComputedStyle(e).transform);
const video = await p.$eval('.bg-video', (v) => ({ src: v.currentSrc.split('/').pop(), paused: v.paused, t: v.currentTime.toFixed(2), ready: v.classList.contains('is-ready') })).catch(() => 'no video');
console.log('bg video:', video);
const canvasOk = await p.$eval('#ambience', (c) => c.classList.contains('is-ready') && c.width > 0);
console.log('feed transforms:', feedX);
console.log('mascot transform changes:', mascot !== mascot2, mascot, mascot2);
console.log('wheel rotor:', rotor, ' ambience canvas ready:', canvasOk);

// tap daily → push screen
await p.tap('.gc-wheel');
await sleep(900);
await p.screenshot({ path: OUT + 'push-wheel-390.png' });
await p.tap('.nav-back');
await sleep(800);
// profile tab
await p.tap('.tab[data-tab="profile"]');
await sleep(1000);
await p.screenshot({ path: OUT + 'profile-390.png' });
await p.close();

// icon sheet close-up (all jelly icons + glyphs + currency, at UI sizes and 2x)
p = await page(390, 844, '?tier=high');
await sleep(1500);
await p.evaluate(() => {
  const names = ['games','profile','bear','heart','rose','cake','gift','leaf','rocket','cup','ring','crown','diamond','seven','acorn','luck','spins','bolt'];
  const star = document.querySelector('.balance .star-ico').getAttribute('src');
  const plus = document.querySelector('.balance-plus').innerHTML;
  const chev = document.querySelector('.gc-go').innerHTML;
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;z-index:999;padding:18px;display:flex;flex-direction:column;gap:14px;background:linear-gradient(180deg,#070818,#0e0a26);font:600 11px system-ui;color:#cfd6ff';
  const row = (size, label) => `<div>${label}</div><div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">` +
    names.map(n => `<span class="ji ji-${n}" style="--ji:${size}px"></span>`).join('') +
    `<img src="${star}" style="width:${size}px;height:${size}px">` +
    `<span class="balance-plus" style="width:${size}px;height:${size}px;border-radius:50%">${plus}</span>` +
    `<span class="gc-go" style="position:static">${chev}</span></div>`;
  d.innerHTML = row(26, 'UI size 26px') + row(52, '52px') ;
  document.body.append(d);
});
await sleep(400);
await p.screenshot({ path: OUT + 'icon-sheet.png', clip: { x: 0, y: 0, width: 390, height: 420 } });
await p.close();

// daily cooldown state + small screen + low tier
p = await page(360, 780, '?tier=low&daily=20000');
await sleep(2000);
await p.screenshot({ path: OUT + 'main-360x780-low.png' });
await p.close();

// english
p = await page(390, 844, '?lang=en&tier=high');
await sleep(1800);
await p.screenshot({ path: OUT + 'main-390-en.png' });
await p.close();

await browser.close();
console.log(errors.length ? 'CONSOLE ISSUES:\n' + errors.join('\n') : 'No console errors/warnings');
