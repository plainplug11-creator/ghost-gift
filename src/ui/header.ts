import { h, html, starIcon } from '../core/dom';
import { fmt, t } from '../core/i18n';
import { store } from '../core/store';
import { tg } from '../core/telegram';
import { createGhost, GHOST_FLAT } from './ghost';
import { glyphPlus } from '../art/games';
import { countTo } from './countup';
import { navigate } from './router';

export function initials(first: string, last?: string) {
  return ((first?.[0] ?? '') + (last?.[0] ?? '')).toUpperCase() || '👻';
}

export function avatar(size: 'sm' | 'lg' = 'sm') {
  const u = tg.user;
  const el = h('span', { class: `avatar avatar-${size}` });
  el.append(h('span', { class: 'avatar-initials' }, initials(u.first_name, u.last_name)));
  if (u.photo_url) {
    const img = h('img', { alt: '', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.onload = () => el.classList.add('has-photo');
    img.onerror = () => img.remove();
    img.src = u.photo_url;
    el.append(img);
  }
  return el;
}

export function mascot(id = 'm') {
  const el = h('span', { class: 'mascot', 'data-press': '' });
  el.append(h('span', { class: 'mascot-glow' }), h('span', { class: 'mascot-shadow' }));
  const bob = h('span', { class: 'mascot-bob' });
  void id;
  const g = createGhost({ mini: true });
  bob.append(g.el);
  el.append(bob);
  // eyes wander now and then; tap → happy hop + star pop
  let gT = 0;
  const wander = () => { if (!el.isConnected && gT) return; g.lookAt((Math.random() - 0.5) * 18, (Math.random() - 0.4) * 12); gT = window.setTimeout(wander, 2200 + Math.random() * 2600); };
  gT = window.setTimeout(wander, 1500);
  el.addEventListener('click', () => {
    el.classList.remove('is-hop'); void el.offsetWidth; el.classList.add('is-hop');
    g.setMood('happy'); setTimeout(() => g.setMood('idle'), 1200);
  });
  el.addEventListener('animationend', (e) => { if (e.animationName === 'ghost-hop') el.classList.remove('is-hop'); });
  return el;
}

export const MASCOT_URL = GHOST_FLAT;

/** Balance pill with animated count-up/down + up/down tint. Used in header and pages. */
export function balancePill(withPlus = true) {
  const amount = h('span', { class: 'balance-amount' }, fmt(store.balance.get()));
  const balance = h('button', { class: 'balance', 'data-press': '', 'aria-label': t('balance.label') });
  balance.append(html(starIcon('star-ico balance-star')), amount);
  if (withPlus) balance.append(html(`<span class="balance-plus" aria-label="${t('balance.topup')}">${glyphPlus}</span>`));
  else balance.classList.add('is-compact');
  balance.addEventListener('click', () => navigate.push('topup'));
  let prev = store.balance.get();
  const unsub = store.balance.sub(() => {
    const next = store.balance.get();
    if (!balance.isConnected && prev !== next) { amount.textContent = fmt(next); prev = next; return; }
    countTo(amount, prev, next, fmt, Math.min(1400, 500 + Math.abs(next - prev)));
    balance.classList.remove('is-bump', 'is-up', 'is-down'); void balance.offsetWidth;
    balance.classList.add('is-bump', next > prev ? 'is-up' : 'is-down');
    prev = next;
  });
  return Object.assign(balance, { unsub });
}

export function createHeader() {
  const brand = h('div', { class: 'brand' }, mascot('hdr'), h('span', { class: 'brand-name' }, t('appName')));
  const balance = balancePill();

  const av = h('button', { class: 'avatar-btn', 'data-press': '', 'data-haptic': 'select', 'aria-label': t('nav.profile') }, avatar('sm'));
  av.addEventListener('click', () => navigate.tab('profile'));

  const header = h('header', { class: 'topbar' }, brand, h('div', { class: 'topbar-right' }, balance, av));
  store.streak.sub(() => header.classList.toggle('is-streak', store.streak.get() >= 3));
  return header;
}
