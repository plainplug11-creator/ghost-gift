import '../styles/prizes.css';
import '../styles/cases.css';
import '../styles/themes.css';
import { h, html, starIcon } from '../core/dom';
import { fmt, t } from '../core/i18n';
import { store } from '../core/store';
import { RARITY_RGB, isNft, isPremium, itemPrize, kindCls, prizeIcon, prizeName, rarityName } from '../art/cases';
import { navBar } from '../ui/nav';
import { balancePill } from '../ui/header';
import { navigate, type Page } from '../ui/router';
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

  const render = () => {
    const items = store.inventory.get();
    const sum = items.reduce((s, i) => s + itemPrize(i).value, 0);
    total.innerHTML = `<span>${t('inv.value')}</span><b>${fmt(sum)}${starIcon('star-ico')}</b>`;
    empty.hidden = items.length > 0;
    grid.replaceChildren(...items.map((it, i) => {
      const p = itemPrize(it);
      const b = h('button', { class: `inv-it r-${p.rarity}${kindCls(p)}${it.status === 'withdrawing' ? ' is-pending' : ''}`, 'data-press': '', style: `--rc:${RARITY_RGB[p.rarity]};--i:${Math.min(i, 12)}` });
      b.innerHTML = `<span class="inv-ico">${prizeIcon(p)}</span><span class="inv-n">${prizeName(p)}</span><span class="inv-r">${isNft(p) ? 'NFT' : isPremium(p) ? 'Premium' : rarityName(p)}</span><span class="inv-v">${fmt(p.value)}${starIcon('star-ico')}</span>${it.status === 'withdrawing' ? `<span class="inv-pending">${t('inv.pending')}</span>` : ''}`;
      b.addEventListener('click', () => openItem(it));
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
    h('div', { class: 'pg-scroll' }, total, h('p', { class: 'inv-note' }, t('inv.note')), prem, grid, empty, rules));
  return { el, destroy() { un(); bal.unsub(); } };
}
