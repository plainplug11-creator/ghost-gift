import { h, html } from '../core/dom';
import { t } from '../core/i18n';
import { ji } from '../art/games';
import { navigate, onRoute, type Tab } from './router';

const ICONS: Record<Tab, string> = { games: ji('games', 'tab-ico'), profile: ji('profile', 'tab-ico') };

export function createTabbar() {
  const indicator = h('span', { class: 'tab-indicator' });
  const inner = h('div', { class: 'tabbar-inner', role: 'tablist' }, indicator);
  const btns = new Map<Tab, HTMLButtonElement>();
  (['games', 'profile'] as Tab[]).forEach((id) => {
    const b = h('button', { class: 'tab', role: 'tab', 'data-press': '', 'data-haptic': 'select', 'data-tab': id });
    b.append(html(ICONS[id]), h('span', { class: 'tab-label' }, t(id === 'games' ? 'nav.games' : 'nav.profile')));
    b.addEventListener('click', () => navigate.tab(id));
    btns.set(id, b); inner.append(b);
  });
  const sync = (tab: Tab) => {
    inner.dataset.active = tab;
    btns.forEach((b, id) => b.setAttribute('aria-selected', String(id === tab)));
  };
  sync('games');
  onRoute((tab) => sync(tab));
  return h('nav', { class: 'tabbar' }, inner);
}
