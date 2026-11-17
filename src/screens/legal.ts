import '../styles/cases.css';
import '../styles/legal.css';
import { h, html, starIcon } from '../core/dom';
import { fmt, lang, t } from '../core/i18n';
import { api } from '../api';
import { caseStats, PRIZES } from '../api/catalog';
import type { CaseDef } from '../api/types';
import { caseImg, caseName, prizeName } from '../art/cases';
import { themeOf, themeVars } from '../art/themes';
import { DOCS, VERIFY, type DocId } from '../legal/docs';
import { navBar } from '../ui/nav';
import { navigate, type Page } from '../ui/router';

const ORDER: DocId[] = ['fair', 'terms', 'privacy', 'play', 'about'];
export const appVersion = () => `${__APP_VERSION__} (${__APP_BUILD__})`;

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
async function roll(serverSeed: string, clientSeed: string, nonce: number) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(serverSeed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${clientSeed}:${nonce}`)));
  return parseInt(sig.slice(0, 13), 16) / 2 ** 52;
}
function pick(c: CaseDef, r: number) {
  const total = c.drops.reduce((s, d) => s + d.weight, 0);
  let x = r * total;
  for (const d of c.drops) { x -= d.weight; if (x < 0) return PRIZES[d.prize]; }
  return PRIZES[c.drops[c.drops.length - 1].prize];
}

/** In-app provably-fair verifier (same math as the server: worker/src/fair.ts). */
function verifier() {
  const V = VERIFY[lang];
  const field = (label: string, ph = '') => { const i = h('input', { class: 'lg-in', placeholder: ph, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' }) as HTMLInputElement; return { i, row: h('label', { class: 'lg-f' }, h('span', null, label), i) }; };
  const ss = field(V.server), cs = field(V.client), nn = field(V.nonce, '0'), hh = field(V.hash);
  nn.i.inputMode = 'numeric';
  const sel = h('select', { class: 'lg-in' }) as HTMLSelectElement;
  api.cases().forEach((c) => sel.append(h('option', { value: c.id }, `${caseName(c)} · ${fmt(c.price)}`)));
  const out = h('div', { class: 'lg-out', 'aria-live': 'polite' });
  const go = h('button', { class: 'btn-primary lg-go', 'data-press': '' }, V.go);
  go.addEventListener('click', async () => {
    if (!crypto.subtle) { out.textContent = 'WebCrypto unavailable'; return; }
    const r = await roll(ss.i.value.trim(), cs.i.value.trim(), Number(nn.i.value) || 0);
    const c = api.cases().find((x) => x.id === sel.value)!;
    const p = pick(c, r);
    let hashLine = '';
    if (hh.i.value.trim()) {
      const d = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ss.i.value.trim())));
      hashLine = `<div class="${d === hh.i.value.trim().toLowerCase() ? 'lg-ok' : 'lg-bad'}">${d === hh.i.value.trim().toLowerCase() ? V.ok : V.bad}</div>`;
    }
    out.innerHTML = `${hashLine}<div><span>${V.roll}</span><b>${r.toFixed(10)}</b></div><div><span>${V.prize}</span><b>${p ? prizeName(p) : '—'}</b></div>`;
  });
  return h('section', { class: 'lg-ver glass' }, h('h3', null, V.title), ss.row, cs.row, nn.row, hh.row, h('label', { class: 'lg-f' }, h('span', null, V.case), sel), go, out);
}

function oddsTable() {
  const V = VERIFY[lang];
  const list = h('div', { class: 'lg-odds' });
  api.cases().filter((c) => c.price > 0).sort((a, b) => a.price - b.price).forEach((c) => {
    const { rtp } = caseStats(c);
    const row = h('button', { class: 'lg-case', 'data-press': '', style: themeVars(themeOf(c)) });
    row.append(html(`<span class="lg-ci">${caseImg(c, '', '44px')}</span><span class="lg-cn">${caseName(c)}<small>${fmt(c.price)}${starIcon('star-ico star-inline')}</small></span><span class="lg-cr">${V.rtp} <b>${(rtp * 100).toFixed(1)}%</b></span>`));
    row.addEventListener('click', () => navigate.push('case', { id: c.id }));
    list.append(row);
  });
  return h('section', { class: 'lg-sec' }, h('h3', null, V.odds), list);
}

export function createLegal(start: DocId = 'fair'): Page {
  let cur: DocId = ORDER.includes(start) ? start : 'fair';
  const tabs = h('div', { class: 'lg-tabs', role: 'tablist' });
  const body = h('article', { class: 'lg-body' });
  const scroll = h('div', { class: 'pg-scroll' });
  const title = h('span');
  const render = () => {
    const d = DOCS[lang][cur];
    title.textContent = d.title;
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === cur)));
    body.replaceChildren(
      h('h1', { class: 'lg-h1' }, d.title), h('div', { class: 'lg-upd' }, d.updated),
      ...d.sections.map((s) => h('section', { class: 'lg-sec' }, s.h ? h('h3', null, s.h) : null, ...s.p.map((p) => h('p', null, p)))),
      ...(cur === 'fair' ? [verifier(), oddsTable()] : []),
    );
    scroll.scrollTo({ top: 0 });
  };
  ORDER.forEach((id) => {
    const b = h('button', { class: 'lg-tab', 'data-press': '', 'data-id': id, role: 'tab' }, DOCS[lang][id].title.split(' · ')[0]);
    b.addEventListener('click', () => { if (cur !== id) { cur = id; render(); b.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' }); } });
    tabs.append(b);
  });
  const foot = h('footer', { class: 'lg-foot' },
    h('div', null, t('about.rights')), h('div', null, t('about.version', { v: appVersion() })), h('div', null, t('about.tg')), h('div', { class: 'lg-age' }, t('about.age')));
  scroll.append(tabs, body, foot);
  render();
  const nav = navBar('');
  nav.querySelector('.pg-title')!.replaceChildren(title);
  return { el: h('div', { class: 'pg pg-legal' }, nav, scroll) };
}
