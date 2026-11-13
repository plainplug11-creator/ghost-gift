import '../styles/prizes.css';
import '../styles/cases.css';
import { h, html, starIcon } from '../core/dom';
import { fmt, t } from '../core/i18n';
import { api } from '../api';
import { caseStats } from '../api/catalog';
import { caseImg, caseName } from '../art/cases';
import { navBar } from '../ui/nav';
import { balancePill } from '../ui/header';
import { navigate, type Page } from '../ui/router';

/** Cases grid (paid cases; the daily one lives on the home card). */
export function createCases(): Page {
  const bal = balancePill(false);
  const grid = h('div', { class: 'case-grid' });
  api.cases().filter((c) => c.price > 0).forEach((c, i) => {
    const { rtp } = caseStats(c);
    const card = h('button', { class: `case-card cc-${c.id}`, 'data-press': '', style: `--glow:${c.glow[0]};--glow2:${c.glow[1]};--i:${i}` });
    card.append(html(`
      <span class="cc-bg"></span>
      <span class="cc-rtp">RTP ${(rtp * 100).toFixed(0)}%</span>
      <span class="cc-art"><span class="cc-float">${caseImg(c, '', '(min-width: 600px) 200px, 150px')}</span><span class="cc-floor"></span></span>
      <span class="cc-name">${caseName(c)}</span>
      <span class="cc-price">${starIcon('star-ico')}${fmt(c.price)}</span>`));
    card.addEventListener('click', () => navigate.push('case', { id: c.id }));
    grid.append(card);
  });
  const el = h('div', { class: 'pg pg-cases' },
    navBar(t('cases.title'), bal),
    h('div', { class: 'pg-scroll' }, h('p', { class: 'pg-lead' }, t('cases.lead')), grid));
  return { el, destroy: () => bal.unsub() };
}
