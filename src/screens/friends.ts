import '../styles/cases.css';
import '../styles/meta.css';
import { h, html, starIcon, starText } from '../core/dom';
import { fmt, t } from '../core/i18n';
import { store } from '../core/store';
import { tg } from '../core/telegram';
import { api } from '../api';
import { REF } from '../api/games';
import { GHOST_FLAT } from '../ui/ghost';
import { navBar } from '../ui/nav';
import { copyText, myRefLink } from '../ui/share';
import type { Page } from '../ui/router';

/** Invite friends: personal bot deep link, stats, rules (bank-safe: rewards come out of the house edge). */
export function createFriends(): Page {
  const link = h('div', { class: 'fr-link' });
  const friends = h('b');
  const earned = h('b');
  const copy = h('button', { class: 'btn-ghost fr-copy', 'data-press': '' }, t('share.copy'));
  const share = h('button', { class: 'btn-primary fr-share', 'data-press': '' }, t('friends.invite'));
  copy.addEventListener('click', () => void copyText(myRefLink()));
  share.addEventListener('click', () => { tg.haptic.medium(); tg.share.link(myRefLink(), t('friends.shareText')); });
  const hero = h('section', { class: 'fr-hero glass' },
    html(`<div class="fr-art"><span class="fr-ring"></span><img src="${GHOST_FLAT}" alt="" class="fr-g1"><img src="${GHOST_FLAT}" alt="" class="fr-g2"><img src="${GHOST_FLAT}" alt="" class="fr-g3"></div>`),
    h('div', { class: 'fr-h1' }, t('friends.h1', { p: REF.pct })),
    h('div', { class: 'mt-sub' }, t('friends.sub', { p: REF.pct, d: REF.days, w: REF.welcomePct })),
    h('div', { class: 'fr-stats' },
      h('div', { class: 'fr-stat' }, friends, h('span', null, t('friends.count'))),
      h('div', { class: 'fr-stat' }, html(`<span class="fr-earn"></span>`), h('span', null, t('friends.earned')))),
    link, h('div', { class: 'fr-btns' }, copy, share));
  hero.querySelector('.fr-earn')!.replaceWith(earned);
  const step = (n: number, title: string, text: string) => h('div', { class: 'fr-step' }, h('span', { class: 'fr-n' }, String(n)), h('div', null, h('b', null, title), h('span', null, starText(text))));
  const how = h('section', { class: 'mt-card glass' },
    h('div', { class: 'mt-title' }, t('friends.how')),
    step(1, t('friends.s1'), t('friends.s1d')),
    step(2, t('friends.s2'), t('friends.s2d', { w: REF.welcomePct, c: REF.welcomeCap })),
    step(3, t('friends.s3'), t('friends.s3d', { p: REF.pct, d: REF.days, c: REF.capPerFriend })));
  const page = h('div', { class: 'pg pg-meta pg-friends' },
    navBar(t('friends.title')),
    h('div', { class: 'pg-scroll mt-scroll' }, hero, how, h('p', { class: 'gk-foot' }, t('friends.foot'))));
  const render = () => {
    const r = store.progress.get()?.ref;
    link.textContent = myRefLink().replace('https://', '');
    friends.textContent = fmt(r?.friends ?? 0);
    earned.innerHTML = `${fmt(r?.earned ?? 0)}${starIcon('star-ico')}`;
  };
  const un = store.progress.sub(render);
  render();
  void api.progress().catch(() => {});
  return { el: page, destroy: un };
}
