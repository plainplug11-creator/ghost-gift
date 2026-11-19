// Live end-to-end check against the deployed Pages site + real Worker API.
// Signs Telegram initData for a QA user with the bot token from env (never printed).
// usage: GHOST_GIFT_BOT_TOKEN=... node scripts/live-e2e.mjs <outDir> [qaUserId]
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = (process.argv[2] || '/tmp/qa-live').replace(/\/?$/, '/'); mkdirSync(OUT, { recursive: true });
const UID = +(process.argv[3] || 100000001);
const SITE = process.env.SITE || 'https://plainplug11-creator.github.io/ghost-gift/';
const API = 'https://ghost-gift-api.ghost-gift.workers.dev';
const T = process.env.GHOST_GIFT_BOT_TOKEN;
const user = JSON.stringify({ id: UID, first_name: 'QA', username: 'gg_qa_bot_test', language_code: 'ru' });
const f = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAqa' + Date.now(), user };
const dcs = Object.keys(f).sort().map((k) => `${k}=${f[k]}`).join('\n');
f.hash = createHmac('sha256', createHmac('sha256', 'WebAppData').update(T).digest()).update(dcs).digest('hex');
const initData = new URLSearchParams(f).toString();
const hash = '#tgWebAppData=' + encodeURIComponent(initData) + '&tgWebAppVersion=8.0&tgWebAppPlatform=ios&tgWebAppThemeParams=' + encodeURIComponent('{"bg_color":"#000000"}');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [], errs = [], apiCalls = [];
const ok = (n, c, d = '') => { log.push(`${c ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); console.log(log.at(-1)); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'ru-RU',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' });
await ctx.addInitScript(() => { localStorage.setItem('gg.onb', '1'); });
async function open(q = '', wait = 2500) {
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errs.push(`[${q}] ${m.text()}`); });
  p.on('pageerror', (e) => errs.push(`[${q}] pageerror: ${e.message}`));
  p.on('response', (r) => { if (r.url().startsWith(API)) apiCalls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  await sleep(+(process.env.GAP || 4000)); // stay well under the 40 req/min per-user API limit
  await p.goto(SITE + q + hash, { waitUntil: 'load' }); await sleep(wait); return p;
}
const shot = (p, n) => p.screenshot({ path: OUT + n + '.png' });
const bal = (p) => p.evaluate(() => { const e = document.querySelector('.bal-v, .balance-v, [data-balance], .hd-bal'); return e ? e.textContent : null; });
const apiJson = (p, path, method = 'GET', body) => p.evaluate(async ([u, m, b]) => { const r = await fetch(u, { method: m, headers: { Authorization: 'tma ' + window.Telegram.WebApp.initData, 'Content-Type': 'application/json', 'x-idempotency-key': crypto.randomUUID() }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; }, [API + path, method, body]);
const step = async (n, fn) => { try { await fn(); } catch (e) { ok(n, false, e.message.split('\n')[0]); } };

let p = await open('');
await step('home+bootstrap', async () => { await shot(p, 'L01-home'); const b = await apiJson(p, '/v1/bootstrap', 'POST', {}); ok('bootstrap (real API, signed initData)', b.s === 200, `balance ${b.j?.balance}`); ok('initData present in WebApp', await p.evaluate(() => !!window.Telegram?.WebApp?.initData)); });
await p.close();

p = await open('?push=wheel', 2500);
await step('wheel', async () => { await shot(p, 'L02-wheel'); const before = (await apiJson(p, '/v1/progress')).j; await p.click('.bet-chip:nth-child(1)'); await p.click('.gk-go'); await sleep(1200); await shot(p, 'L02b-wheel-spin');
  await p.waitForSelector('.pg-wheel:not(.is-spinning)', { timeout: 20000 }); await sleep(1000); await shot(p, 'L02c-wheel-result');
  const after = (await apiJson(p, '/v1/progress')).j; ok('wheel spin (real /v1/wheel)', apiCalls.some((c) => c.startsWith('POST /v1/wheel 200')), `xp ${before?.xp}→${after?.xp}, quests.wheel ${after?.quests?.wheel}`); });
await p.close();

p = await open('?push=slots', 2500);
await step('slots', async () => { await p.click('.bet-chip:nth-child(1)'); await p.click('.gk-go'); await sleep(900); await shot(p, 'L03-slots-spin');
  await p.waitForSelector('.pg-slots:not(.is-spinning)', { timeout: 20000 }); await sleep(900); await shot(p, 'L03b-slots-result');
  ok('slots spin (real /v1/slots)', apiCalls.some((c) => c.startsWith('POST /v1/slots 200'))); });
await p.close();

p = await open('?push=luck', 2500);
await step('luck', async () => { await shot(p, 'L04-luck'); await p.click('.lk-card.lk-1', { force: true }); await sleep(2600); await shot(p, 'L04b-luck-drawn');
  const pr = (await apiJson(p, '/v1/progress')).j; ok('luck draw (real /v1/luck/draw)', pr?.luck?.pct > 0, `+${pr?.luck?.pct}% until ${new Date(pr?.luck?.until).toISOString()}`); });
await p.close();

p = await open('?push=quests', 2500);
await step('streak', async () => { await shot(p, 'L05-quests'); if (await p.locator('.mt-claim:not([disabled])').count()) await p.click('.mt-claim'); await sleep(1500); await shot(p, 'L05b-streak-claimed');
  const pr = (await apiJson(p, '/v1/progress')).j; ok('streak claim (real /v1/streak/claim)', pr?.streak?.claimedToday === true, `count ${pr?.streak?.count}`); });
await step('quest claim', async () => { const b = p.locator('.mt-q .btn-primary, .mt-q-claim').first(); if (await b.count()) { await b.click(); await sleep(1200); ok('quest claim', apiCalls.some((c) => c.startsWith('POST /v1/quests/claim 200'))); } else ok('quest claim (none ready yet)', true, 'skipped'); await shot(p, 'L05c-quests-after'); });
await p.close();

p = await open('?push=case:spark', 2500);
await step('case open', async () => { await p.click('.cd-open'); await p.waitForSelector('.bs.is-open', { timeout: 25000 }); await sleep(900); await shot(p, 'L06-case-result');
  ok('case open (real /v1/open)', apiCalls.some((c) => c.startsWith('POST /v1/open 200'))); });
await p.close();

p = await open('?push=inventory', 2500);
await step('inventory bulk sell', async () => { await shot(p, 'L07-inventory'); const n = await p.locator('.inv-it:not(.is-pending)').count();
  if (!n) return ok('inventory bulk sell', true, 'inventory empty (all wins were stars) — skipped');
  await p.click('.inv-sel-btn'); await sleep(300); await p.click('.inv-bar-all'); await sleep(300); await shot(p, 'L07b-select'); await p.click('.inv-bar-sell'); await sleep(800); await shot(p, 'L07c-confirm');
  await p.locator('.bs.is-open .btn-primary').last().click(); await sleep(1500); await shot(p, 'L07d-sold');
  ok('bulk sell (real /v1/sell-many)', apiCalls.some((c) => c.startsWith('POST /v1/sell-many 200')), `${n} items`); });
await p.close();

for (const [id, n] of [['leaders', 'L08-leaders'], ['friends', 'L09-friends'], ['settings', 'L10-settings']]) { p = await open(`?push=${id}`, 2500); await shot(p, n);
  if (id === 'leaders') { const lb = (await apiJson(p, '/v1/leaderboard')).j; ok('leaderboard (real)', !!lb?.week, `me rank ${lb?.me?.rank}, top ${lb?.top?.length}`); }
  if (id === 'friends') { const link = await p.locator('.fr-link').textContent(); ok('referral link', /GhostGift_Game\?start(app)?=ref_/.test(link || ''), link?.trim()); }
  if (id === 'settings') { const rows = p.locator('button.row[role=switch]'); const cnt = await rows.count(); let hit = false;
    for (let i = 0; i < cnt; i++) { await rows.nth(i).click(); await sleep(700); if (apiCalls.some((c) => c.startsWith('POST /v1/settings 200'))) { hit = true; await shot(p, 'L10b-settings-toggled'); await rows.nth(i).click(); await sleep(700); break; } }
    const s = (await apiJson(p, '/v1/progress')).j?.settings; ok('settings saved on server', hit, JSON.stringify(s)); }
  await p.close(); }

p = await open('', 3000);
// make sure there is at least one real win to show (QA balance only; bank delta is returned by the cleanup script)
for (let i = 0; i < 10; i++) { const f0 = (await apiJson(p, '/v1/feed')).j; if ((f0?.feed || []).length) break; await apiJson(p, '/v1/wheel', 'POST', { bet: 10 }); await sleep(2500); }
await p.close(); p = await open('', 3000);
await step('feed', async () => { const fd = (await apiJson(p, '/v1/feed')).j; ok('live feed has our plays', (fd?.feed || []).length > 0, `${fd?.feed?.length} wins, 24h stats ${JSON.stringify(fd?.stats)}`);
  await sleep(16000); ok('feed live chip (real 24h count) rendered', await p.locator('.chip-live').count() > 0, await p.locator('.chip-live').first().textContent().catch(() => ''));
  const ago = await p.locator('.feed .chip-item').allTextContents(); ok('feed chips show real age', ago.some((x) => /мин|только что|ч$/.test(x)), ago.slice(0, 3).join(' | ')); await shot(p, 'L11-home-after'); });
p = await open('?tab=profile', 2500); await shot(p, 'L12-profile'); await p.close();

const bad = apiCalls.filter((c) => !/ 2\d\d$/.test(c));
ok('no API errors', !bad.length, bad.join(', '));
ok('no console errors', !errs.length, errs.slice(0, 6).join(' | '));
writeFileSync(OUT + 'report.txt', [...log, '', 'API calls:', ...apiCalls, '', 'console errors:', ...errs].join('\n'));
await browser.close();
