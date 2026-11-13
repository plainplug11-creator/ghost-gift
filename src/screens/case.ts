import '../styles/prizes.css';
import '../styles/cases.css';
import { h, html, starIcon } from '../core/dom';
import { fmt, t } from '../core/i18n';
import { store } from '../core/store';
import { tg } from '../core/telegram';
import { setSound } from '../core/sound';
import { api, ApiError } from '../api';
import { caseById, caseStats } from '../api/catalog';
import { RARITY_RANK, type OpenResult } from '../api/types';
import { RARITY_RGB, caseImg, caseName, prizeIcon, prizeName, rarityName } from '../art/cases';
import { navBar } from '../ui/nav';
import { balancePill } from '../ui/header';
import { openSheet, toast } from '../ui/sheet';
import type { Page } from '../ui/router';
import { createOpening, type Opening } from './opening';
import { openShare } from './sheets';
import { createPerch } from '../ui/perch';
import '../styles/perch.css';

const pad = (n: number) => String(n).padStart(2, '0');
const hms = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${pad((s / 3600) | 0)}:${pad(((s % 3600) / 60) | 0)}:${pad(s % 60)}`; };

function soundToggle() {
  const b = h('button', { class: 'snd-btn', 'data-press': '', 'aria-label': t('case.sound') });
  const sync = () => { b.classList.toggle('is-on', store.sound.get()); b.innerHTML = store.sound.get()
    ? '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="#fff"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="#fff" opacity=".7"/><path d="M16 9.5l5 5M21 9.5l-5 5" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/></svg>'; };
  sync();
  const un = store.sound.sub(sync);
  b.addEventListener('click', () => setSound(!store.sound.get()));
  return Object.assign(b, { unsub: un });
}

export function createCase(id: string): Page {
  const c = caseById(id)!;
  const isDaily = c.price === 0;
  const { rows, rtp } = caseStats(c);
  const bal = balancePill(false);
  const snd = soundToggle();

  // ── hero ──
  const hero = h('div', { class: 'cd-hero', style: `--glow:${c.glow[0]};--glow2:${c.glow[1]}` });
  hero.append(html(`<span class="cd-rays" aria-hidden="true"></span><span class="cd-tw" aria-hidden="true">${'<i></i>'.repeat(6)}</span><span class="cd-halo"></span><span class="cd-float">${caseImg(c, 'cd-img', '240px')}</span><span class="cd-floor"></span>`));
  // header: our ghost on an autumn branch, looking down at the case; tap = hop
  const perch = createPerch({ bubble: false });
  hero.prepend(perch.el);
  perch.lookAt(8, 7);
  perch.el.querySelector('.pc-ghost')!.addEventListener('click', () => tg.haptic.soft());
  // hero scrolled away → its loops (branch leaves, ghost, rays) pause
  const heroIO = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => hero.classList.toggle('is-idle', !e.isIntersecting)) : null;
  heroIO?.observe(hero);
  const glance = window.setInterval(() => { perch.lookAt(1, 1); setTimeout(() => perch.lookAt(8, 7), 1300); }, 6500);

  // ── actions ──
  const openBtn = h('button', { class: 'btn-primary cd-open', 'data-press': '' });
  const demoBtn = h('button', { class: 'btn-ghost cd-demo', 'data-press': '' }, t('case.demo'));
  const hint = h('p', { class: 'cd-hint' }, t('case.demoHint'));
  let timer = 0;
  const renderOpen = () => {
    clearTimeout(timer);
    if (isDaily) {
      const left = store.dailyReadyAt.get() - Date.now();
      openBtn.disabled = left > 0;
      openBtn.textContent = left > 0 ? t('case.dailyWait', { t: hms(left) }) : t('case.openFree');
      if (left > 0) timer = window.setTimeout(renderOpen, 1000 - (Date.now() % 1000) + 5);
    } else {
      openBtn.replaceChildren(h('span', null, t('case.open')), html(`<span class="cd-price">${fmt(c.price)}${starIcon('star-ico')}</span>`));
      openBtn.classList.toggle('is-short', store.balance.get() < c.price);
    }
  };
  renderOpen();
  const unBal = store.balance.sub(renderOpen);
  const unDaily = store.dailyReadyAt.sub(renderOpen);

  // ── RTP + fairness ──
  const hashEl = h('code', { class: 'cd-hash' }, '…');
  const nonceEl = h('span', null, '');
  const refreshHash = () => api.nextRoundHash().then((f) => { hashEl.textContent = `${f.serverSeedHash.slice(0, 10)}…${f.serverSeedHash.slice(-6)}`; nonceEl.textContent = t('case.fairHash', { n: f.nonce }); });
  refreshHash();
  const info = h('div', { class: 'cd-info glass' },
    isDaily ? null : h('div', { class: 'cd-rtp' },
      h('div', null, h('div', { class: 'cd-k' }, t('case.rtp')), h('div', { class: 'cd-sub' }, t('case.rtpHint'))),
      h('div', { class: 'cd-rtp-v' }, `${(rtp * 100).toFixed(1)}%`)),
    h('div', { class: 'cd-fair' },
      html(`<span class="cd-shield">✓</span>`),
      h('div', { class: 'cd-fair-t' }, h('div', { class: 'cd-k' }, t('case.fair')), h('div', { class: 'cd-sub' }, nonceEl, ' · ', hashEl))),
  );
  info.querySelector('.cd-fair')!.addEventListener('click', () => toast(t('case.fairNote'), 'info'));

  // ── contents: ALL prizes with exact chance ──
  const list = h('div', { class: 'cd-list' });
  rows.forEach(({ prize, chance }, i) => {
    const pct = chance * 100;
    list.append(html(`
      <div class="pz r-${prize.rarity}" style="--rc:${RARITY_RGB[prize.rarity]};--i:${i}">
        <span class="pz-ico">${prizeIcon(prize)}</span>
        <span class="pz-n">${prizeName(prize)}</span>
        <span class="pz-v">${fmt(prize.value)}${starIcon('star-ico')}</span>
        <span class="pz-c">${pct >= 10 ? pct.toFixed(1) : pct >= 1 ? pct.toFixed(2) : pct.toFixed(3)}%</span>
      </div>`));
  });
  const contents = h('section', { class: 'cd-contents' },
    h('div', { class: 'cd-sec' }, h('span', null, t('case.contents')), h('span', { class: 'cd-sec-n' }, t('case.items', { n: rows.length }))), list);

  const scroll = h('div', { class: 'pg-scroll' }, hero, h('div', { class: 'cd-actions' }, openBtn, demoBtn), hint, info, contents);
  const el = h('div', { class: `pg pg-case cd-${c.id}` }, navBar(caseName(c), snd, bal), scroll);

  // ── opening orchestration ──
  let opening: Opening | null = null;
  async function open(demo: boolean) {
    if (opening) return;
    if (!demo && !isDaily && store.balance.get() < c.price) { tg.haptic.error(); toast(t('case.noBalance'), 'err'); bal.classList.remove('is-shake'); void bal.offsetWidth; bal.classList.add('is-shake'); return; }
    let res: OpenResult;
    try {
      el.classList.add('is-busy');
      res = await api.openCase(c.id, { demo });
    } catch (e) {
      el.classList.remove('is-busy');
      tg.haptic.error();
      toast(e instanceof ApiError && e.code === 'NO_BALANCE' ? t('case.noBalance') : t('err.generic'), 'err');
      return;
    }
    // optimistic display: spend now, credit after the reveal
    if (!demo && c.price) store.balance.set(store.balance.get() - c.price);
    tg.closingConfirmation(true);
    opening = createOpening(c, res);
    el.append(opening.el);
    el.classList.add('is-opening');
    await opening.run();
    if (!demo) {
      api.commit();
      if (RARITY_RANK[res.prize.rarity] >= 1) store.lastWin.set({ ...res.prize });
    }
    tg.closingConfirmation(false);
    showResult(res);
  }

  function finish() {
    const o = opening; opening = null;
    el.classList.remove('is-opening', 'is-busy');
    refreshHash();
    return o?.destroy();
  }

  function showResult(res: OpenResult) {
    const p = res.prize;
    const rank = RARITY_RANK[p.rarity];
    const btns: HTMLElement[] = [];
    let next: (() => void) | null = null;
    const act = (label: Node[] | string, cls: string, fn: () => void) => {
      const b = h('button', { class: cls, 'data-press': '' });
      typeof label === 'string' ? (b.textContent = label) : b.append(...label);
      b.addEventListener('click', () => { next = fn; sheet.close(); });
      btns.push(b);
      return b;
    };
    const priceLabel = (pre: string, n: number) => [h('span', null, pre), html(`<span class="cd-price">${fmt(n)}${starIcon('star-ico')}</span>`)];

    if (res.demo) {
      if (isDaily) act(t('result.demoAgain'), 'btn-primary', () => open(true));
      else {
        act(priceLabel(t('result.real'), c.price), 'btn-primary', () => open(false));
        act(t('result.demoAgain'), 'btn-ghost', () => open(true));
      }
    } else if (p.kind === 'stars') {
      if (!isDaily) act(priceLabel(t('result.again'), c.price), 'btn-primary', () => open(false));
      act(t('common.done'), isDaily ? 'btn-primary' : 'btn-ghost', () => {});
    } else {
      act(t('result.toInv'), 'btn-primary', () => toast(t('result.saved')));
      act(priceLabel(t('result.sell'), p.value), 'btn-ghost', async () => {
        const r = await api.sell(res.itemUid!); tg.haptic.success(); toast(t('result.sold', { n: fmt(r.credited) }));
      });
      if (!isDaily) act(priceLabel(t('result.again'), c.price), 'btn-ghost', () => open(false));
    }
    if (!res.demo && rank >= 2) {
      const sh = h('button', { class: 'rs-share', 'data-press': '', 'aria-label': t('result.share') });
      sh.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>';
      sh.addEventListener('click', () => openShare(p));
      btns.unshift(sh);
    }
    const head = h('div', { class: 'rs-head' },
      h('div', null,
        h('div', { class: 'rs-k' }, res.demo ? t('result.demoNote') : p.kind === 'stars' ? t('result.credited') : t('result.title')),
        h('div', { class: 'rs-n' }, prizeName(p)),
        html(`<div class="rs-meta"><span class="rs-r">${rarityName(p)}</span><span class="rs-v">${t('result.value')} · ${fmt(p.value)}${starIcon('star-ico')}</span></div>`)),
      btns[0]?.classList.contains('rs-share') ? btns.shift()! : null);
    const fair = h('div', { class: 'rs-fair' }, `#${res.fairness.nonce} · seed ${res.fairness.serverSeed?.slice(0, 8) ?? '—'}… · hash ${res.fairness.serverSeedHash.slice(0, 8)}…`);
    const sheet = openSheet([head, h('div', { class: `rs-actions n${btns.length}` }, ...btns), fair], {
      cls: `rs r-${p.rarity}${res.demo ? ' is-demo' : ''}`,
      onClose: async () => { opening?.reveal.classList.add('is-out'); await finish(); const f = next; next = null; f?.(); },
    });
    sheet.el.style.setProperty('--rc', RARITY_RGB[p.rarity]);
  }

  openBtn.addEventListener('click', () => open(false));
  demoBtn.addEventListener('click', () => open(true));

  const qs = new URLSearchParams(location.search);
  if (qs.has('autoopen')) setTimeout(() => open(qs.get('autoopen') === 'demo'), 500);

  return {
    el,
    // Back during the show = fast-forward (never leave mid-opening)
    onBack() { if (opening) { opening.skip(); return false; } },
    destroy() { heroIO?.disconnect(); clearInterval(glance); perch.destroy(); clearTimeout(timer); unBal(); unDaily(); bal.unsub(); snd.unsub(); },
  };
}
