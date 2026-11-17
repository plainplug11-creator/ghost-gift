import '../styles/prizes.css';
import '../styles/cases.css';
import '../styles/themes.css';
import { h, html, starIcon } from '../core/dom';
import { fmt, t, type I18nKey } from '../core/i18n';
import { tier as perfTier } from '../core/perf';
import { api } from '../api';
import { caseStats } from '../api/catalog';
import { caseImg, caseName } from '../art/cases';
import { fxHtml, themeOf, themeVars, type Theme } from '../art/themes';
import { navBar } from '../ui/nav';
import { balancePill } from '../ui/header';
import { navigate, type Page } from '../ui/router';

/** Cases grid (paid cases; the daily one lives on the home card), grouped into three leagues. */
export function createCases(): Page {
  const bal = balancePill(false);
  const cases = api.cases().filter((c) => c.price > 0).sort((a, b) => a.price - b.price);
  const top = cases[cases.length - 1];
  const groups = new Map<Theme['tier'], HTMLElement>();
  let i = 0;
  for (const c of cases) {
    const th = themeOf(c);
    const { rtp } = caseStats(c);
    const isTop = c === top && cases.length > 3;
    const card = h('button', { class: `case-card cc-${c.id} th-${th.key}${isTop ? ' is-top' : ''}`, 'data-press': '', 'data-theme': th.key, style: `${themeVars(th)};--i:${i++}` });
    card.append(html(`
      <span class="cc-bg"></span>
      ${perfTier === 'low' ? '' : fxHtml(th, 6, 'cc-fx')}
      <span class="cc-rtp">RTP ${(rtp * 100).toFixed(0)}%</span>
      ${isTop ? `<span class="cc-top">${t('cases.top')}</span>` : ''}
      <span class="cc-art"><span class="cc-float">${caseImg(c, '', '(min-width: 600px) 200px, 150px')}</span><span class="cc-floor"></span></span>
      <span class="cc-name">${caseName(c)}</span>
      <span class="cc-price">${starIcon('star-ico')}${fmt(c.price)}</span>`));
    card.addEventListener('click', () => navigate.push('case', { id: c.id }));
    let g = groups.get(th.tier);
    if (!g) {
      g = h('div', { class: 'case-grid' });
      groups.set(th.tier, g);
    }
    g.append(card);
  }
  const sections = (['start', 'classic', 'high'] as const).filter((k) => groups.has(k)).map((k) =>
    h('section', { class: `cg-sec cg-${k}` },
      h('div', { class: 'cg-head' }, h('span', { class: 'cg-title' }, t(`cases.tier.${k}` as I18nKey)), h('span', { class: 'cg-line', 'aria-hidden': 'true' })),
      groups.get(k)!));
  const el = h('div', { class: 'pg pg-cases' },
    navBar(t('cases.title'), bal),
    h('div', { class: 'pg-scroll' }, h('p', { class: 'pg-lead' }, t('cases.lead')), ...sections));
  return { el, destroy: () => bal.unsub() };
}
