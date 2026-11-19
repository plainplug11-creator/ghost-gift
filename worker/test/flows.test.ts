import { describe, expect, it } from 'vitest';
import { signInitData } from '../src/auth.ts';
import { CASES, PRIZES, liveDrops } from '../src/catalog.ts';
import { fairRoll, newSeed } from '../src/fair.ts';
import { cronTick, resetGiftCache } from '../src/delivery.ts';
import { TgError } from '../src/telegram.ts';
import { TOKEN, makeFlowApp } from './fake-tg.ts';

type App = ReturnType<typeof makeFlowApp>;
let nextUser = 50_000;
const newUser = () => String(++nextUser);
const ADMIN = '777000';

async function req(a: App, method: string, path: string, user: string, body?: unknown, extra: Record<string, string> = {}) {
  const init = await signInitData({ user: JSON.stringify({ id: Number(user), first_name: 'U', username: `u${user}`, language_code: 'ru' }), auth_date: String(Math.floor(Date.now() / 1000)) }, TOKEN);
  const r = await a.app.handle({ method, url: path, headers: { authorization: `tma ${init}`, 'x-device-id': `d-${user}`, ...extra }, body: body === undefined ? '' : JSON.stringify(body), ip: `198.51.100.${Number(user) % 250}` });
  return r as { status: number; body: any };
}
async function hook(a: App, update: unknown, secret?: string) {
  const r = await a.app.handle({ method: 'POST', url: '/v1/webhook/telegram', headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {}, body: JSON.stringify(update), ip: '149.154.167.1' });
  return r as { status: number; body: any };
}
/** Existing (not new), low-risk player with a balance. */
async function veteran(a: App, balance = 0) {
  const u = newUser();
  await req(a, 'POST', '/v1/bootstrap', u);
  await a.db.prepare('UPDATE users SET created_at = ?, balance = ? WHERE id = ?').bind(Date.now() - 10 * 86400_000, balance, u).run();
  return u;
}
async function giveItem(a: App, user: string, prizeId: string, nftId: number | null = null, value: number | null = null) {
  const uid = `it${Math.random().toString(16).slice(2, 10)}`;
  await a.db.prepare("INSERT INTO inventory (uid, user_id, prize_id, case_id, won_at, status, nft_id, value) VALUES (?, ?, ?, 'ghost', ?, 'owned', ?, ?)").bind(uid, user, prizeId, Date.now(), nftId, value).run();
  return uid;
}
async function makeAdmin(a: App) {
  await a.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_id', ?)").bind(ADMIN).run();
}
async function connectBusiness(a: App, rights: Record<string, boolean> = { can_view_gifts_and_stars: true, can_transfer_and_upgrade_gifts: true, can_transfer_stars: true }) {
  return hook(a, { update_id: Math.floor(Math.random() * 1e9), business_connection: { id: 'bc1', user: { id: Number(ADMIN) }, user_chat_id: Number(ADMIN), rights, is_enabled: true, date: 1 } });
}
async function addNft(a: App, tier: string, value: number, owned = `og-${Math.random()}`, name = 'MagicPotion-1', title = 'Magic Potion #1') {
  const r = await a.db.prepare("INSERT INTO nft_stock (owned_gift_id, name, title, value, tier, transfer_cost, status, added_at) VALUES (?, ?, ?, ?, ?, 25, 'in_stock', ?) RETURNING id")
    .bind(owned, name, title, value, tier, Date.now()).first<{ id: number }>();
  return r!.id;
}
const status = async (a: App, table: string, col: string, id: string | number) =>
  (await a.db.prepare(`SELECT status FROM ${table} WHERE ${col} = ?`).bind(id).first<{ status: string }>())?.status;

describe('bot basics', () => {
  it('/start answers with a WebApp play button; duplicate update ids are ignored', async () => {
    const a = makeFlowApp();
    const up = { update_id: 9001, message: { message_id: 1, from: { id: 42, language_code: 'en' }, chat: { id: 42, type: 'private' }, text: '/start' } };
    expect((await hook(a, up)).body).toEqual({ start: true });
    const m = a.tg.of('sendMessage')[0].params;
    expect(m.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://plainplug11-creator.github.io/ghost-gift/');
    expect((await hook(a, up)).body).toEqual({ duplicate: true });
    expect(a.tg.of('sendMessage')).toHaveLength(1);
  });

  it('rejects webhook calls without the secret token', async () => {
    const a = makeFlowApp({ webhookSecret: 's3cret' });
    expect((await hook(a, { update_id: 1 })).status).toBe(401);
    expect((await hook(a, { update_id: 9002 }, 's3cret')).status).toBe(200);
  });

  it('admin claim: right code works once; anything else records a request', async () => {
    const a = makeFlowApp();
    await a.db.prepare("DELETE FROM settings WHERE key = 'admin_id'").run();
    await a.db.prepare('DELETE FROM admin_requests').run();
    const msg = (from: number, text: string) => ({ message: { message_id: 1, from: { id: from, username: `n${from}`, first_name: 'Kyryl' }, chat: { id: from, type: 'private' }, text } });
    expect((await hook(a, msg(13, '/admin'))).body).toEqual({ claim: 'requested' });
    expect(a.tg.of('sendMessage').at(-1)!.params.text).toBe('Запрос отправлен');
    expect((await hook(a, msg(11, '/admin nope'))).body).toEqual({ claim: 'requested' });
    expect((await hook(a, msg(13, '/admin'))).body).toEqual({ claim: 'requested' });
    const reqs = (await a.db.prepare('SELECT tg_id, username, first_name, attempts, status FROM admin_requests ORDER BY tg_id').all()).results;
    expect(reqs).toEqual([
      { tg_id: '11', username: 'n11', first_name: 'Kyryl', attempts: 1, status: 'pending' },
      { tg_id: '13', username: 'n13', first_name: 'Kyryl', attempts: 2, status: 'pending' },
    ]);
    expect(await a.db.prepare("SELECT value FROM settings WHERE key = 'admin_id'").first()).toBeNull();
    expect((await hook(a, msg(11, '/admin c0ffee'))).body).toEqual({ claim: 'ok' });
    expect((await hook(a, msg(12, '/admin c0ffee'))).body).toEqual({ claim: 'requested' });
    expect((await hook(a, msg(11, '/admin'))).body).toEqual({ admin: 'help' });
    expect((await hook(a, msg(11, '/stats'))).body).toMatchObject({ stats: expect.anything() });
    expect((await hook(a, msg(12, '/stats'))).body).toEqual({ unknown: true });
    // operator promotion (what scripts/promote-admin.sh runs)
    await a.db.batch([
      a.db.prepare("INSERT INTO settings (key, value) VALUES ('admin_id', '13') ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
      a.db.prepare("UPDATE admin_requests SET status = 'promoted' WHERE tg_id = '13'"),
    ]);
    expect((await hook(a, msg(13, '/stats'))).body).toMatchObject({ stats: expect.anything() });
    await a.db.prepare("DELETE FROM settings WHERE key = 'admin_id'").run();
  });
});

describe('star top-up', () => {
  it('invoice → pre-checkout → payment credits once', async () => {
    const a = makeFlowApp();
    const u = await veteran(a);
    const t = await req(a, 'POST', '/v1/topup', u, { stars: 250 });
    expect(t.status).toBe(200);
    expect(t.body.link).toContain('https://t.me/');
    const inv = a.tg.of('createInvoiceLink')[0].params;
    expect(inv).toMatchObject({ currency: 'XTR', prices: [{ amount: 250 }] });
    const pq = (amount: number, from = Number(u)) => ({ pre_checkout_query: { id: `q${amount}${from}`, from: { id: from }, currency: 'XTR', total_amount: amount, invoice_payload: inv.payload } });
    expect((await hook(a, pq(250))).body).toEqual({ preCheckout: 'ok' });
    expect((await hook(a, pq(100))).body).toEqual({ preCheckout: 'rejected' });
    expect((await hook(a, pq(250, 1))).body).toEqual({ preCheckout: 'rejected' });
    expect(a.tg.of('answerPreCheckoutQuery').map((c) => c.params.ok)).toEqual([true, false, false]);
    const paid = { message: { message_id: 2, from: { id: Number(u) }, chat: { id: Number(u), type: 'private' }, successful_payment: { currency: 'XTR', total_amount: 250, invoice_payload: inv.payload, telegram_payment_charge_id: `ch-${u}` } } };
    expect((await hook(a, { update_id: 7_000_000 + Number(u), ...paid })).body).toMatchObject({ status: 'credited', balance: 250 });
    expect((await hook(a, paid)).body).toMatchObject({ status: 'duplicate' });
    const s = await req(a, 'GET', `/v1/invoice?id=${t.body.invoiceId}`, u);
    expect(s.body).toEqual({ status: 'paid', stars: 250, balance: 250 });
    expect((await req(a, 'GET', `/v1/invoice?id=${t.body.invoiceId}`, newUser())).status).toBe(404);
    expect((await req(a, 'POST', '/v1/topup', u, { stars: 0 })).status).toBe(400);
  });

  it('refund claws back the balance', async () => {
    const a = makeFlowApp();
    const u = await veteran(a);
    await hook(a, { message: { from: { id: Number(u) }, chat: { id: Number(u), type: 'private' }, successful_payment: { currency: 'XTR', total_amount: 100, invoice_payload: u, telegram_payment_charge_id: `rf-${u}` } } });
    const r = await hook(a, { message: { from: { id: Number(u) }, chat: { id: Number(u), type: 'private' }, refunded_payment: { currency: 'XTR', total_amount: 100, invoice_payload: u, telegram_payment_charge_id: `rf-${u}` } } });
    expect(r.body).toMatchObject({ status: 'refunded', balance: 0 });
  });
});

describe('prize delivery', () => {
  it('gift withdrawal is sent instantly via sendGift', async () => {
    resetGiftCache();
    const a = makeFlowApp();
    const u = await veteran(a);
    const uid = await giveItem(a, u, 'heart');
    const w = await req(a, 'POST', '/v1/withdraw', u, { uid }, { 'x-idempotency-key': `w-${uid}` });
    expect(w.body).toEqual({ status: 'queued', review: false });
    await a.settle();
    expect(a.tg.of('sendGift')[0].params).toMatchObject({ user_id: Number(u), gift_id: 'g-heart' });
    expect(await status(a, 'inventory', 'uid', uid)).toBe('delivered');
    // idempotent replay does not send twice
    expect((await req(a, 'POST', '/v1/withdraw', u, { uid }, { 'x-idempotency-key': `w-${uid}` })).body).toEqual({ status: 'queued', review: false });
    await a.settle();
    expect(a.tg.of('sendGift')).toHaveLength(1);
    expect((await req(a, 'GET', '/v1/inventory', u)).body.inventory).toHaveLength(0);
  });

  it('waits for funds when the bot has no stars, then cron delivers', async () => {
    resetGiftCache();
    const a = makeFlowApp();
    await makeAdmin(a);
    a.tg.stars = 0;
    const u = await veteran(a);
    const uid = await giveItem(a, u, 'cup');
    await req(a, 'POST', '/v1/withdraw', u, { uid });
    await a.settle();
    const d = await a.db.prepare('SELECT id, status FROM deliveries WHERE user_id = ?').bind(u).first<{ id: string; status: string }>();
    expect(d!.status).toBe('waiting_funds');
    expect(a.tg.of('sendMessage').some((m) => m.params.chat_id === Number(ADMIN))).toBe(true);
    a.tg.stars = 500;
    await a.db.prepare('UPDATE deliveries SET next_at = 0 WHERE id = ?').bind(d!.id).run();
    await cronTick(a.app.ctx);
    expect(await status(a, 'deliveries', 'id', d!.id)).toBe('delivered');
    expect(a.tg.of('sendGift')).toHaveLength(1);
  });

  it('network error on a money call becomes "unknown" (never auto-resent); admin decides', async () => {
    resetGiftCache();
    const a = makeFlowApp();
    await makeAdmin(a);
    a.tg.handlers.sendGift = () => { throw new TgError(0, 'fetch failed', 0, true); };
    const u = await veteran(a);
    const uid = await giveItem(a, u, 'bear');
    await req(a, 'POST', '/v1/withdraw', u, { uid });
    await a.settle();
    const d = await a.db.prepare('SELECT id, status FROM deliveries WHERE user_id = ?').bind(u).first<{ id: string; status: string }>();
    expect(d!.status).toBe('unknown');
    await cronTick(a.app.ctx);
    expect(a.tg.of('sendGift')).toHaveLength(1);
    const cb = await hook(a, { callback_query: { id: 'cb1', from: { id: Number(ADMIN) }, data: `dx:${d!.id}`, message: { message_id: 5, chat: { id: Number(ADMIN) }, text: 'x' } } });
    expect(cb.body).toMatchObject({ ok: true });
    expect(await status(a, 'inventory', 'uid', uid)).toBe('owned');
  });

  it('Premium purchase is delivered with giftPremiumSubscription', async () => {
    const a = makeFlowApp();
    const u = await veteran(a, 2000);
    const r = await req(a, 'POST', '/v1/buy-premium', u, { months: 3 });
    expect(r.body).toEqual({ status: 'queued', balance: 2000 - 1050, review: false });
    await a.settle();
    expect(a.tg.of('giftPremiumSubscription')[0].params).toMatchObject({ user_id: Number(u), month_count: 3, star_count: 1000 });
    expect((await req(a, 'POST', '/v1/buy-premium', u, { months: 12 })).status).toBe(400);
  });

  it('large withdrawals go to review; admin approve delivers, reject returns the item', async () => {
    const a = makeFlowApp();
    await makeAdmin(a);
    const u = await veteran(a);
    const uid = await giveItem(a, u, 'prem12');
    const w = await req(a, 'POST', '/v1/withdraw', u, { uid });
    expect(w.body).toEqual({ status: 'queued', review: true });
    await a.settle();
    const card = a.tg.of('sendMessage').find((m) => m.params.chat_id === Number(ADMIN));
    const btns = card!.params.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(btns[0]).toMatch(/^wa:/);
    const wid = btns[0].slice(3);
    const notAdmin = await hook(a, { callback_query: { id: 'c0', from: { id: 1 }, data: `wa:${wid}` } });
    expect(notAdmin.body).toEqual({ callback: 'denied' });
    expect((await hook(a, { callback_query: { id: 'c1', from: { id: Number(ADMIN) }, data: `wa:${wid}`, message: { message_id: 1, chat: { id: Number(ADMIN) }, text: 'card' } } })).body).toMatchObject({ ok: true });
    await a.settle();
    expect(a.tg.of('giftPremiumSubscription')[0].params).toMatchObject({ month_count: 12, star_count: 2500 });
    expect(a.tg.of('editMessageText')).toHaveLength(1);

    const uid2 = await giveItem(a, u, 'prem12');
    await req(a, 'POST', '/v1/withdraw', u, { uid: uid2 });
    const w2 = await a.db.prepare('SELECT id FROM withdrawals WHERE item_uid = ?').bind(uid2).first<{ id: string }>();
    await hook(a, { callback_query: { id: 'c2', from: { id: Number(ADMIN) }, data: `wr:${w2!.id}` } });
    expect(await status(a, 'inventory', 'uid', uid2)).toBe('owned');
    expect(await status(a, 'withdrawals', 'id', w2!.id)).toBe('rejected');
  });
});

describe('NFT prizes', () => {
  it('auto mode without a Business connection: 409 NFT_PENDING, item stays sellable and returns to stock', async () => {
    const a = makeFlowApp({ nftDelivery: 'auto' });
    await a.db.prepare("UPDATE business_connections SET enabled = 0").run();
    const u = await veteran(a);
    const nftId = await addNft(a, 'nft_potion', 5970);
    await a.db.prepare("UPDATE nft_stock SET status = 'reserved' WHERE id = ?").bind(nftId).run();
    const uid = await giveItem(a, u, 'nft_potion', nftId, 5970);
    const inv = (await req(a, 'GET', '/v1/inventory', u)).body.inventory;
    expect(inv[0]).toMatchObject({ value: 5970, nft: { title: 'Magic Potion #1', link: 'https://t.me/nft/MagicPotion-1' } });
    expect((await req(a, 'POST', '/v1/withdraw', u, { uid })).body).toEqual({ error: 'NFT_PENDING' });
    const s = await req(a, 'POST', '/v1/sell', u, { uid });
    expect(s.body).toEqual({ balance: 5970, credited: 5970 });
    expect(await status(a, 'nft_stock', 'id', nftId)).toBe('in_stock');
    await a.db.prepare("UPDATE nft_stock SET status = 'removed' WHERE id = ?").bind(nftId).run();
  });

  it('auto mode with the owner Business connection: review → approve → transferGift', async () => {
    const a = makeFlowApp({ nftDelivery: 'auto' });
    await makeAdmin(a);
    await connectBusiness(a);
    const owned = 'owned-xyz';
    a.tg.handlers.getBusinessAccountGifts = () => ({ total_count: 1, gifts: [{ type: 'unique', owned_gift_id: owned, can_be_transferred: true, transfer_star_count: 25, gift: { name: 'MagicPotion-1', base_name: 'Magic Potion', number: 1 } }] });
    const u = await veteran(a);
    const nftId = await addNft(a, 'nft_potion', 5970, owned);
    await a.db.prepare("UPDATE nft_stock SET status = 'reserved' WHERE id = ?").bind(nftId).run();
    const uid = await giveItem(a, u, 'nft_potion', nftId, 5970);
    expect((await req(a, 'POST', '/v1/withdraw', u, { uid })).body).toEqual({ status: 'queued', review: true });
    const w = await a.db.prepare('SELECT id, reason FROM withdrawals WHERE item_uid = ?').bind(uid).first<{ id: string; reason: string }>();
    expect(w!.reason).toContain('nft');
    await hook(a, { callback_query: { id: 'n1', from: { id: Number(ADMIN) }, data: `wa:${w!.id}` } });
    await a.settle();
    expect(a.tg.of('transferGift')[0].params).toEqual({ business_connection_id: 'bc1', owned_gift_id: owned, new_owner_chat_id: Number(u), star_count: 25 });
    expect(await status(a, 'nft_stock', 'id', nftId)).toBe('delivered');
    await a.db.prepare("UPDATE business_connections SET enabled = 0").run();
  });

  it('manual mode (default): withdraw → admin card → «Выдано» marks delivered and notifies the winner', async () => {
    const a = makeFlowApp();
    await makeAdmin(a);
    const u = await veteran(a);
    const nftId = await addNft(a, 'nft_witchhat', 660, `manual:t:${Math.random()}`, '', 'Witch Hat');
    await a.db.prepare("UPDATE nft_stock SET status = 'reserved' WHERE id = ?").bind(nftId).run();
    const uid = await giveItem(a, u, 'nft_witchhat', nftId, 660);
    const inv = (await req(a, 'GET', '/v1/inventory', u)).body.inventory;
    expect(inv[0].nft).toEqual({ title: 'Witch Hat', name: '', link: 'https://fragment.com/gifts/witchhat', art: 'witchhat-7' });
    expect((await req(a, 'POST', '/v1/withdraw', u, { uid })).body).toEqual({ status: 'queued', review: false, manual: true });
    await a.settle();
    expect(a.tg.of('transferGift')).toHaveLength(0);
    const card = a.tg.of('sendMessage').find((m) => m.params.chat_id === Number(ADMIN) && /Выдай NFT вручную/.test(m.params.text))!;
    expect(card.params.text).toContain('Witch Hat');
    expect(card.params.text).toContain(`@u${u}`);
    expect(card.params.text).toContain('660 ⭐');
    const [btnOk, btnNo] = card.params.reply_markup.inline_keyboard[0];
    expect(btnOk.text).toBe('✅ Выдано');
    expect(btnNo.text).toContain('Отклонить');
    expect(a.tg.of('sendMessage').some((m) => m.params.chat_id === Number(u) && /отправляется/.test(m.params.text))).toBe(true);
    expect((await req(a, 'GET', '/v1/inventory', u)).body.inventory[0].status).toBe('withdrawing');
    const res = await hook(a, { callback_query: { id: 'm1', from: { id: Number(ADMIN) }, data: btnOk.callback_data, message: { chat: { id: Number(ADMIN) }, message_id: 5, text: 'card' } } });
    expect(res.body).toMatchObject({ callback: 'dd', ok: true });
    expect(await status(a, 'nft_stock', 'id', nftId)).toBe('delivered');
    expect(await status(a, 'inventory', 'uid', uid)).toBe('delivered');
    expect(a.tg.of('sendMessage').some((m) => m.params.chat_id === Number(u) && /передан/.test(m.params.text))).toBe(true);
    // a second tap does nothing
    expect((await hook(a, { callback_query: { id: 'm2', from: { id: Number(ADMIN) }, data: btnOk.callback_data } })).body).toMatchObject({ ok: false });
  });

  it('manual mode: «Отклонить» refunds the NFT value in Stars and returns the unit to stock', async () => {
    const a = makeFlowApp();
    await makeAdmin(a);
    const u = await veteran(a, 10);
    const nftId = await addNft(a, 'nft_evileye', 900, `manual:t:${Math.random()}`, '', 'Evil Eye');
    await a.db.prepare("UPDATE nft_stock SET status = 'reserved' WHERE id = ?").bind(nftId).run();
    const uid = await giveItem(a, u, 'nft_evileye', nftId, 900);
    await req(a, 'POST', '/v1/withdraw', u, { uid });
    await a.settle();
    const card = a.tg.of('sendMessage').find((m) => /Выдай NFT вручную/.test(m.params.text))!;
    const no = card.params.reply_markup.inline_keyboard[0][1].callback_data;
    expect((await hook(a, { callback_query: { id: 'x1', from: { id: Number(ADMIN) }, data: no } })).body).toMatchObject({ ok: true });
    const bal = await a.db.prepare('SELECT balance FROM users WHERE id = ?').bind(u).first<{ balance: number }>();
    expect(bal!.balance).toBe(910);
    expect(await status(a, 'inventory', 'uid', uid)).toBe('refunded');
    expect(await status(a, 'nft_stock', 'id', nftId)).toBe('in_stock');
    expect(a.tg.of('sendMessage').some((m) => m.params.chat_id === Number(u) && /900/.test(m.params.text))).toBe(true);
    await a.db.prepare("UPDATE nft_stock SET status = 'removed' WHERE id = ?").bind(nftId).run();
  });

  it('collections are listed only while in stock, can drop from a case, and the admin gets a heads-up', async () => {
    const a = makeFlowApp();
    await makeAdmin(a);
    await a.db.prepare("UPDATE nft_stock SET status = 'removed' WHERE status = 'in_stock'").run();
    const u0 = await veteran(a);
    let cases = (await req(a, 'GET', '/v1/cases', u0)).body.cases;
    const king = () => cases.find((c: any) => c.id === 'king');
    expect(king().drops.some((d: any) => d.prize.startsWith('nft'))).toBe(false);
    for (let i = 0; i < 30; i++) await addNft(a, 'nft_scaredcat', 26090, `manual:sc:${i}:${Math.random()}`, '', 'Scared Cat');
    for (let i = 0; i < 30; i++) await addNft(a, 'nft_astral', 13660, `manual:as:${i}:${Math.random()}`, '', 'Astral Shard');
    cases = (await req(a, 'GET', '/v1/cases', u0)).body.cases;
    expect(king().drops.filter((d: any) => d.prize.startsWith('nft')).map((d: any) => d.prize).sort()).toEqual(['nft_astral', 'nft_scaredcat']);

    const u = await veteran(a, 5000);
    const row = await a.db.prepare('SELECT client_seed, nonce FROM users WHERE id = ?').bind(u).first<{ client_seed: string; nonce: number }>();
    const table = liveDrops(CASES.find((c) => c.id === 'king')!, { nftInStock: ['nft_astral', 'nft_scaredcat'] });
    const total = table.reduce((s, d) => s + d.weight, 0);
    const isNft = (r: number) => { let x = r * total; for (const d of table) { x -= d.weight; if (x < 0) return d.prize.startsWith('nft'); } return false; };
    let seed = '';
    for (let i = 0; !seed; i++) { const s = newSeed(); if (isNft(await fairRoll(s, row!.client_seed, row!.nonce + 1))) seed = s; }
    await a.db.prepare('UPDATE users SET server_seed = ? WHERE id = ?').bind(seed, u).run();
    const r = await req(a, 'POST', '/v1/open', u, { caseId: 'king' });
    expect(r.status).toBe(200);
    const got = r.body;
    expect(got.prize.kind).toBe('nft');
    expect(['Scared Cat', 'Astral Shard']).toContain(got.prize.nft.title);
    expect(got.prize.nft.art).toMatch(/^(scaredcat|astralshard)-\d+$/);
    const reserved = await a.db.prepare("SELECT COUNT(*) AS n FROM nft_stock WHERE status = 'reserved' AND item_uid = ?").bind(got.itemUid).first<{ n: number }>();
    expect(reserved!.n).toBe(1);
    await a.settle();
    expect(a.tg.of('sendMessage').some((m) => m.params.chat_id === Number(ADMIN) && /Выпал NFT/.test(m.params.text))).toBe(true);
    await a.db.prepare("UPDATE nft_stock SET status = 'removed' WHERE status = 'in_stock'").run();
  }, 60_000);

  it('/nft_stock sets hand-delivered stock per collection; /nft lists collections', async () => {
    const a = makeFlowApp();
    await makeAdmin(a);
    const msg = (text: string) => ({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, from: { id: Number(ADMIN) }, chat: { id: Number(ADMIN), type: 'private' }, text } });
    await hook(a, msg('/nft_stock nft_hexpot 3'));
    const n = async () => (await a.db.prepare("SELECT COUNT(*) AS n FROM nft_stock WHERE tier = 'nft_hexpot' AND status = 'in_stock'").first<{ n: number }>())!.n;
    expect(await n()).toBe(3);
    await hook(a, msg('/nft_stock nft_hexpot 1'));
    expect(await n()).toBe(1);
    await hook(a, msg('/nft'));
    expect(a.tg.of('sendMessage').at(-1)!.params.text).toContain('Hex Pot');
    await hook(a, msg('/nft_stock nft_hexpot 0'));
    expect(await n()).toBe(0);
  });
});

describe('economy guards on the server', () => {
  it('every case opens; new cases exist with name/theme', async () => {
    const a = makeFlowApp();
    for (const id of ['spark', 'lantern', 'aurora', 'phantom', 'king']) {
      const c = CASES.find((x) => x.id === id)!;
      expect(c.name.ru && c.name.en && c.theme).toBeTruthy();
    }
    const u = await veteran(a, 20_000);
    for (const c of CASES.filter((x) => x.price > 0 && x.price <= 3500)) {
      const r = await req(a, 'POST', '/v1/open', u, { caseId: c.id });
      expect(r.status, c.id).toBe(200);
      expect(PRIZES[r.body.prize.id]).toBeTruthy();
    }
  });

  it('below reserve only prizes worth ≤ the price can drop', async () => {
    const a = makeFlowApp({ bankReserve: 10_000_000 });
    const u = await veteran(a, 100 * 30);
    for (let i = 0; i < 30; i++) {
      const r = await req(a, 'POST', '/v1/open', u, { caseId: 'ghost' });
      expect(r.body.prize.value).toBeLessThanOrEqual(100);
    }
  });
});
