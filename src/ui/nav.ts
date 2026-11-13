import { h, html } from '../core/dom';
import { t } from '../core/i18n';
import { glyphBack } from '../art/games';
import { navigate } from './router';

/** Pushed-page nav bar: jelly back button, title, optional right slot. */
export function navBar(title: string, ...right: (Node | null)[]) {
  const back = h('button', { class: 'nav-back', 'data-press': '', 'aria-label': t('common.back') });
  back.append(html(glyphBack));
  back.addEventListener('click', () => navigate.back());
  return h('div', { class: 'pg-nav' }, back, h('span', { class: 'pg-title' }, title), h('span', { class: 'pg-right' }, ...right));
}
