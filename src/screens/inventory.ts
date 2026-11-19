import { flyReward } from '../ui/reward';
import '../styles/prizes.css';
import '../styles/cases.css';
import '../styles/themes.css';
import { h, html, starIcon } from '../core/dom';
import { fmt, t } from '../core/i18n';
import { store } from '../core/store';
import { RARITY_RGB, isNft, isPremium, itemPrize, kindCls, reviewSet, prizeIcon, prizeName, rarityName } from '../art/cases';
import { navBar } from '../ui/nav';
import { balancePill } from '../ui/header';
import { navigate, type Page } from '../ui/router';
import { openSheet, toast } from '../ui/sheet';
import { tg } from '../core/telegram';
import { sfx } from '../core/sound';
import { api } from '../api';
import { apiErrorText } from '../api/errors';
import type { InvItem } from '../api/types';

type Sort = 'new' | 'value' | 'rarity';
const RANK: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
import { openItem, openPremium, openRules } from './sheets';

export function createInventory(): Page {
  const bal = balancePill(false);
  const total = h('div', { class: 'inv-total' });
  const grid = h('div', { class: 'inv-grid' });
  const empty = h('div', { class: 'inv-empty' },
    html(`<span class="pi pi-gift inv-empty-ico"></span>`),
    h('div', { class: 'inv-empty-t' }, t('inv.empty')),
    h('div', { class: 'inv-empty-s' }, t('inv.emptySub')));
  const toCases = h('button', { class: 'btn-primary', 'data-press': '' }, t('inv.toCases'));
  toCases.addEventListener('click', () => navigate.push('cases'));
  empty.append(toCases);

  // sort + multi-select (bulk sell)
  let sort: Sort = ((): Sort => { try { return (localStorage.getItem('gg.invSort') as Sort) || 'new'; } catch { return 'new'; } })();
  let selecting = false;
  const sel = new Set<string>();
  const sortSeg = h('div', { class: 'inv-sort', role: 'radiogroup' }, ...(['new', 'value', 'rarity'] as Sort[]).map((k) => {
    const b = h('button', { class: 'inv-sort-b', 'data-press': '', 'data-haptic': 'select', 'data-k': k }, t(`inv.sort.${k}` as never));
    b.addEventListener('click', () => { sort = k; try { localStorage.setItem('gg.invSort', k); } catch { /* */ } render(); });
    return b;
  }));
  const selBtn = h('button', { class: 'inv-sel-btn', 'data-press': '' });
  const tools = h('div', { class: 'inv-tools' }, sortSeg, selBtn);
  const barInfo = h('span', { class: 'inv-bar-i' });
  const barAll = h('button', { class: 'inv-bar-all', 'data-press': '' }, t('inv.selAll'));
  const barSell = h('button', { class: 'btn-primary inv-bar-sell', 'data-press': '' });
  const bar = h('div', { class: 'inv-bar' }, h('div', { class: 'inv-bar-l' }, barInfo, barAll), barSell);
  const sellable = () => store.inventory.get().filter((i) => i.status === 'owned');
  const selValue = () => sellable().filter((i) => sel.has(i.uid)).reduce((s, i) => s + itemPrize(i).value, 0);
  const setSelecting = (on: boolean) => { selecting = on; sel.clear(); render(); };
  selBtn.addEventListener('click', () => setSelecting(!selecting));
  barAll.addEventListener('click', () => { const all = sellable(); if (sel.size === all.length) sel.clear(); else all.forEach((i) => sel.add(i.uid)); tg.haptic.select(); render(); });
  barSell.addEventListener('click', () => {
    const uids = sellable().filter((i) => sel.has(i.uid)).map((i) => i.uid);
    if (!uids.length) return;
    const v = selValue();
    const ok = h('button', { class: 'btn-primary inv-sell-ok', 'data-press': '' }, html(`${t('inv.sellN', { n: uids.length })} · ${fmt(v)}${starIcon('star-ico')}`));
    const no = h('button', { class: 'btn-ghost', 'data-press': '' }, t('inv.cancel'));
    const sh = openSheet([h('div', { class: 'sh-title' }, t('inv.sellConfirm')), h('p', { class: 'inv-note' }, t('inv.sellConfirmSub')), h('div', { class: 'rs-actions n2' }, ok, no)], { cls: 'sh' });
    no.addEventListener('click', () => void sh.close());
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      try {
        const from = ok.getBoundingClientRect();
        const r = await api.sellMany(uids);
        sfx.coin(); tg.haptic.success();
        flyReward(from, r.credited);
        toast(t('inv.soldN', { n: uids.length, v: fmt(r.credited) }), 'ok');
        void sh.close(); setSelecting(false);
      } catch (e) { ok.disabled = false; toast(apiErrorText(e), 'err'); }
    });
  });
  const sorted = (items: InvItem[]) => {
    const a = items.slice();
    if (sort === 'value') a.sort((x, y) => itemPrize(y).value - itemPrize(x).value);
    else if (sort === 'rarity') a.sort((x, y) => (RANK[itemPrize(y).rarity] ?? 0) - (RANK[itemPrize(x).rarity] ?? 0) || itemPrize(y).value - itemPrize(x).value);
    else a.sort((x, y) => (y.wonAt ?? 0) - (x.wonAt ?? 0));
    return a;
  };

  const render = () => {
    const items = sorted(store.inventory.get());
    [...sortSeg.children].forEach((b) => b.classList.toggle('is-on', (b as HTMLElement).dataset.k === sort));
    selBtn.textContent = selecting ? t('inv.cancel') : t('inv.select');
    selBtn.hidden = !sellable().length && !selecting;
    tools.hidden = !items.length;
    for (const u of [...sel]) if (!items.some((i) => i.uid === u && i.status === 'owned')) sel.delete(u);
    bar.classList.toggle('is-on', selecting);
    barInfo.innerHTML = sel.size ? `${t('inv.selected', { n: sel.size })} · <b>${fmt(selValue())}${starIcon('star-ico')}</b>` : t('inv.tapToSelect');
    barSell.textContent = t('inv.sellBtn');
    barSell.disabled = !sel.size;
    const review = reviewSet();
    const sum = items.reduce((s, i) => s + itemPrize(i).value, 0);
    total.innerHTML = `<span>${t('inv.value')}</span><b>${fmt(sum)}${starIcon('star-ico')}</b>`;
    empty.hidden = items.length > 0;
    grid.replaceChildren(...items.map((it, i) => {
      const p = itemPrize(it);
      const b = h('button', { class: `inv-it r-${p.rarity}${kindCls(p)}${it.status === 'withdrawing' ? ' is-pending' : ''}${selecting ? ' is-selecting' : ''}${sel.has(it.uid) ? ' is-sel' : ''}`, 'data-press': '', style: `--rc:${RARITY_RGB[p.rarity]};--i:${Math.min(i, 12)}` });
      b.innerHTML = `<span class="inv-ico">${prizeIcon(p)}</span><span class="inv-n">${prizeName(p)}</span><span class="inv-r">${isNft(p) ? 'NFT' : isPremium(p) ? 'Premium' : rarityName(p)}</span><span class="inv-v">${fmt(p.value)}${starIcon('star-ico')}</span>${it.status === 'withdrawing' ? (review.has(it.uid) ? `<span class="inv-pending is-review">${t('inv.review')}</span>` : isNft(p) ? `<span class="inv-pending is-nft">${t('nft.sending')}</span>` : `<span class="inv-pending">${t('inv.pending')}</span>`) : ''}`;
      if (selecting) b.insertAdjacentHTML('beforeend', '<span class="inv-check" aria-hidden="true"></span>');
      b.addEventListener('click', () => {
        if (!selecting) return openItem(it);
        if (it.status !== 'owned') { tg.haptic.warning(); return; }
        sel.has(it.uid) ? sel.delete(it.uid) : sel.add(it.uid); tg.haptic.select(); render();
      });
      return b;
    }));
  };
  render();
  const un = store.inventory.sub(render);

  const prem = h('button', { class: 'inv-prem glass', 'data-press': '' },
    html(`<span class="pi pi-crown"></span>`), h('span', { class: 'inv-prem-t' }, h('b', null, t('inv.premium')), h('span', null, t('prem.note'))),
    html('<span class="inv-chev">›</span>'));
  prem.addEventListener('click', openPremium);
  const rules = h('button', { class: 'inv-rules', 'data-press': '' }, t('inv.rules'));
  rules.addEventListener('click', openRules);

  const el = h('div', { class: 'pg pg-inv' },
    navBar(t('inv.title'), bal),
    h('div', { class: 'pg-scroll' }, total, h('p', { class: 'inv-note' }, t('inv.note')), prem, tools, grid, empty, rules),
    bar);
  return { el, onBack: () => { if (selecting) { setSelecting(false); return false; } }, destroy() { un(); bal.unsub(); } };
}
