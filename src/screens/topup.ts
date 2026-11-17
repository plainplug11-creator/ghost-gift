import '../styles/cases.css';
import '../styles/legal.css';
import { h, html, starIcon } from '../core/dom';
import { fmt, t } from '../core/i18n';
import { store } from '../core/store';
import { tg } from '../core/telegram';
import { api } from '../api';
import { TOPUP_PACKS } from '../api/catalog';
import { apiErrorText } from '../api/errors';
import { navBar } from '../ui/nav';
import { balancePill } from '../ui/header';
import { toast } from '../ui/sheet';
import { navigate, type Page } from '../ui/router';


export function createTopup(): Page {
  const bal = balancePill(false);
  const now = h('div', { class: 'tu-now glass' }, h('span', null, t('topup.balance')), html(`<b class="tu-bal">${starIcon('star-ico')}<span>${fmt(store.balance.get())}</span></b>`));
  const unBal = store.balance.sub(() => { now.querySelector('.tu-bal span')!.textContent = fmt(store.balance.get()); });
  let busy = false;
  const buy = async (n: number, card: HTMLElement) => {
    if (busy) return;
    busy = true; card.classList.add('is-busy');
    try {
      const r = await api.topUp(n);
      if (r.status === 'paid') { tg.haptic.success(); toast(t('topup.done')); card.classList.add('is-paid'); setTimeout(() => card.classList.remove('is-paid'), 1600); }
      else if (r.status === 'pending') toast(t('topup.pending'), 'info');
      else if (r.status === 'cancelled') toast(t('topup.cancel'), 'info');
      else { tg.haptic.error(); toast(t('err.generic'), 'err'); }
    } catch (e) { tg.haptic.error(); toast(apiErrorText(e), 'err'); }
    finally { busy = false; card.classList.remove('is-busy'); }
  };
  const list: readonly number[] = TOPUP_PACKS;
  const grid = h('div', { class: 'tu-grid' });
  list.forEach((n, i) => {
    const lvl = Math.min(4, Math.floor((i / Math.max(1, list.length - 1)) * 4));
    const badge = i === 2 ? t('topup.popular') : i === list.length - 1 ? t('topup.best') : '';
    const card = h('button', { class: `tu-pack lv${lvl}${badge ? ' has-badge' : ''}`, 'data-press': '', style: `--i:${i}` });
    card.innerHTML = `${badge ? `<span class="tu-badge">${badge}</span>` : ''}
      <span class="tu-stars">${Array.from({ length: lvl + 1 }, (_, k) => `<span class="tu-s" style="--k:${k}">${starIcon('star-ico')}</span>`).join('')}</span>
      <span class="tu-n">${fmt(n)}</span>
      <span class="tu-p">${t('topup.pay', { n: fmt(n) })}</span>`;
    card.addEventListener('click', () => buy(n, card));
    grid.append(card);
  });
  const legal = h('button', { class: 'tu-legal', 'data-press': '' }, t('profile.docs'));
  legal.addEventListener('click', () => navigate.push('legal', { id: 'terms' }));
  const el = h('div', { class: 'pg pg-topup' },
    navBar(t('topup.title'), bal),
    h('div', { class: 'pg-scroll' },
      html(`<div class="tu-hero"><span class="tu-glow"></span><span class="tu-big">${starIcon('star-ico')}</span></div>`),
      h('p', { class: 'tu-sub' }, t('topup.sub')), now, grid, h('p', { class: 'tu-note' }, t('topup.note')), legal));
  return { el, destroy() { unBal(); bal.unsub(); } };
}
