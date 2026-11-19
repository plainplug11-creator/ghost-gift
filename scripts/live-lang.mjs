// Live language check: uk / de / en Telegram users + settings picker + legal pages, on the deployed site + real API.
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
const OUT = (process.argv[2] || '/tmp/qa-lang').replace(/\/?$/, '/'); mkdirSync(OUT, { recursive: true });
const SITE = 'https://plainplug11-creator.github.io/ghost-gift/', T = process.env.GHOST_GIFT_BOT_TOKEN, UID = 100000001;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hashFor = (lc) => { const f = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAqa' + Date.now(), user: JSON.stringify({ id: UID, first_name: 'QA', language_code: lc }) };
  const dcs = Object.keys(f).sort().map((k) => `${k}=${f[k]}`).join('\n');
  f.hash = createHmac('sha256', createHmac('sha256', 'WebAppData').update(T).digest()).update(dcs).digest('hex');
  return '#tgWebAppData=' + encodeURIComponent(new URLSearchParams(f).toString()) + '&tgWebAppVersion=8.0&tgWebAppPlatform=ios'; };
const b = await chromium.launch(); const errs = [];
const res = [];
for (const [lc, q, stale] of [['uk', '', null], ['uk', '?push=settings', 'uk'], ['de', '', null], ['en', '', null], ['uk', '?lang=uk', null], ['ru', '?push=legal:terms', null], ['en', '?push=legal:fair', null]]) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((s) => { localStorage.setItem('gg.onb', '1'); if (s) localStorage.setItem('gg.lang', s); }, stale);
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(SITE + q + hashFor(lc)); await sleep(3500);
  const r = await p.evaluate(() => ({ lang: document.documentElement.lang, seg: [...document.querySelectorAll('.st-seg-b')].map((e) => e.textContent), ukText: /[іїєґІЇЄҐ]/.test(document.body.innerText), title: document.querySelector('h1,h2,.lg-title')?.textContent?.slice(0, 40) }));
  const name = `lang-${lc}${q.replace(/[?=:&]/g, '_')}${stale ? '-stale' : ''}`; await p.screenshot({ path: OUT + name + '.png' });
  res.push({ lc, q, stale, ...r }); await sleep(1500); await ctx.close();
}
console.log(JSON.stringify(res, null, 1)); console.log('errors:', errs);
await b.close();
