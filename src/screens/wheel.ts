import '../styles/cases.css';
import '../styles/play.css';
import { h, html, starIcon } from '../core/dom';
import { fmt, t } from '../core/i18n';
import { store } from '../core/store';
import { tg } from '../core/telegram';
import { reducedMotion, setFocus, tier } from '../core/perf';
import { sfx, unlockAudio } from '../core/sound';
import { api, ApiError } from '../api';
import { apiErrorText } from '../api/errors';
import { WHEEL, WHEEL_TOTAL, tableRtp, wheelArc } from '../api/games';
import { navBar } from '../ui/nav';
import { balancePill } from '../ui/header';
import { toast } from '../ui/sheet';
import { createGhost } from '../ui/ghost';
import { confetti } from '../ui/confetti';
import { betPicker, bezier, historyStrip, needStars, openOdds, resultBanner, tickHaptic } from '../ui/gamekit';
import type { Page } from '../ui/router';

/** Segment palette by multiplier — cool neon for small, hot magenta/purple for big, gold + iris for the top. */
const SEG: Record<string, { fill: string; text: string }> = {
  '0': { fill: 'url(#whZero)', text: 'rgba(200,210,255,.55)' },
  '0.5': { fill: 'url(#whHalf)', text: '#cdb8ff' },
  '1.2': { fill: 'url(#whBlue)', text: '#dfe8ff' },
  '1.5': { fill: 'url(#whCyan)', text: '#e8fdff' },
  '2': { fill: 'url(#whMag)', text: '#fff0fb' },
  '3': { fill: 'url(#whPurp)', text: '#fff' },
  '5': { fill: 'url(#whGold)', text: '#3a2400' },
  '10': { fill: 'url(#whIris)', text: '#fff' },
};
const pt = (a: number, r: number) => { const rad = (a * Math.PI) / 180; return [r * Math.sin(rad), -r * Math.cos(rad)]; };
const f2 = (n: number) => n.toFixed(2);

function wheelSvg() {
  let paths = '', labels = '', pegs = '', tags = '';
  WHEEL.forEach((s, i) => {
    const { from, to } = wheelArc(i);
    const [x0, y0] = pt(from, 92), [x1, y1] = pt(to, 92);
    const large = to - from > 180 ? 1 : 0;
    const c = SEG[String(s.m)];
    paths += `<path d="M0 0L${f2(x0)} ${f2(y0)}A92 92 0 ${large} 1 ${f2(x1)} ${f2(y1)}Z" fill="${c.fill}" class="${s.m === 0 && i % 2 ? 'alt' : ''}"/>`;
    const [px, py] = pt(from, 89);
    pegs += `<circle cx="${f2(px)}" cy="${f2(py)}" r="1.6"/>`;
    const mid = (from + to) / 2;
    if (to - from >= 10) {
      const [lx, ly] = pt(mid, 66);
      labels += `<text x="${f2(lx)}" y="${f2(ly)}" transform="rotate(${f2(mid)} ${f2(lx)} ${f2(ly)})" fill="${c.text}" class="${s.m >= 2 ? 'hot' : ''}">${s.m === 0 ? '×0' : `×${s.m}`}</text>`;
    } else {
      const [jx, jy] = pt(mid, 80);
      tags += `<g class="wh-jewel ${s.m >= 10 ? 'top' : ''}"><circle cx="${f2(jx)}" cy="${f2(jy)}" r="3.2"/><text x="${f2(pt(mid, 46)[0])}" y="${f2(pt(mid, 46)[1])}" transform="rotate(${f2(mid)} ${f2(pt(mid, 46)[0])} ${f2(pt(mid, 46)[1])})">×${s.m}</text></g>`;
    }
  });
  return `<svg class="wh-svg" viewBox="-100 -100 200 200" aria-hidden="true">
    <defs>
      <radialGradient id="whZero" r="1"><stop offset=".25" stop-color="#1a1d4a"/><stop offset="1" stop-color="#0b0d26"/></radialGradient>
      <radialGradient id="whHalf" r="1"><stop offset=".2" stop-color="#4a2a9a"/><stop offset="1" stop-color="#22134e"/></radialGradient>
      <radialGradient id="whBlue" r="1"><stop offset=".2" stop-color="#4f7bff"/><stop offset="1" stop-color="#1d2f8a"/></radialGradient>
      <radialGradient id="whCyan" r="1"><stop offset=".2" stop-color="#5cf0ff"/><stop offset="1" stop-color="#0f7ea8"/></radialGradient>
      <radialGradient id="whMag" r="1"><stop offset=".2" stop-color="#ff6fd8"/><stop offset="1" stop-color="#8a1d78"/></radialGradient>
      <radialGradient id="whPurp" r="1"><stop offset=".2" stop-color="#b47dff"/><stop offset="1" stop-color="#5320b8"/></radialGradient>
      <radialGradient id="whGold" r="1"><stop offset=".2" stop-color="#fff0b0"/><stop offset="1" stop-color="#e0a83a"/></radialGradient>
      <linearGradient id="whIris" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#46e6ff"/><stop offset=".5" stop-color="#a65cff"/><stop offset="1" stop-color="#ff5ccc"/></linearGradient>
      <radialGradient id="whGloss" r=".9"><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></radialGradient>
    </defs>
    <g class="wh-segs">${paths}</g>
    <circle r="92" fill="url(#whGloss)"/>
    <g class="wh-labels">${labels}</g>
    <g class="wh-tags">${tags}</g>
    <g class="wh-pegs">${pegs}</g>
    <path class="wh-win" d=""/>
  </svg>`;
}

function bulbs(n = 24) {
  let c = '';
  for (let i = 0; i < n; i++) { const [x, y] = pt((i / n) * 360, 96.5); c += `<circle cx="${f2(x)}" cy="${f2(y)}" r="2.3" class="${i % 2 ? 'b2' : 'b1'}"/>`; }
  return `<svg class="wh-ring" viewBox="-100 -100 200 200" aria-hidden="true"><circle r="96.5" class="wh-ring-band"/><g class="wh-bulbs">${c}</g></svg>`;
}

export function createWheel(): Page {
  const bal = balancePill(false);
  const odds = h('button', { class: 'gk-info', 'data-press': '', 'aria-label': t('game.odds') }, 'i');
  const rot = h('div', { class: 'wh-rot' });
  rot.innerHTML = wheelSvg();
  const winPath = rot.querySelector('.wh-win') as SVGPathElement;
  const ghost = createGhost({ mini: true, cls: 'wh-ghost' });
  const pointer = html('<div class="wh-pointer" aria-hidden="true"><svg viewBox="0 0 40 52"><defs><linearGradient id="whPin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#ff7ad9"/><stop offset="1" stop-color="#a65cff"/></linearGradient></defs><path d="M20 50C16 38 4 28 4 17a16 16 0 0 1 32 0c0 11-12 21-16 33z" fill="url(#whPin)" stroke="#fff" stroke-opacity=".8" stroke-width="1.5"/><circle cx="20" cy="17" r="6" fill="#140a30"/><circle cx="20" cy="17" r="3" fill="#3fe3ff"/></svg></div>').firstElementChild as HTMLElement;
  const hub = h('div', { class: 'wh-hub' }, ghost.el);
  const stage = h('div', { class: 'wh-stage' }, h('span', { class: 'wh-glow' }), html(bulbs()), rot, hub, pointer);
  const fx = h('canvas', { class: 'gk-fx', 'aria-hidden': 'true' });
  const flash = h('div', { class: 'gk-flash', 'aria-hidden': 'true' });

  const result = resultBanner();
  const hist = historyStrip('wheel');
  const spinBtn = h('button', { class: 'btn-primary gk-go', 'data-press': '' });
  const picker = betPicker('wheel', () => renderBtn());
  function renderBtn() {
    const b = picker.get(), lim = picker.limit();
    spinBtn.replaceChildren(h('span', null, t('wheel.spin')), html(`<span class="gk-price">${fmt(b)}${starIcon('star-ico')}</span>`));
    spinBtn.classList.toggle('is-short', store.balance.get() < b);
    if (lim === 0) result.hint(t('game.paused'));
  }
  const unBal = store.balance.sub(renderBtn);
  renderBtn();
  result.hint(t('wheel.hint'));

  const page = h('div', { class: 'pg pg-game pg-wheel' },
    navBar(t('games.wheel'), odds, bal),
    h('div', { class: 'pg-scroll gk-scroll' },
      stage, result.el, hist.el,
      h('div', { class: 'gk-panel glass' }, h('div', { class: 'gk-label' }, t('game.bet')), picker.el, spinBtn),
      h('p', { class: 'gk-foot' }, t('wheel.foot')),
    ),
    fx, flash,
  );

  odds.addEventListener('click', () => {
    const by = new Map<number, number>();
    for (const s of WHEEL) by.set(s.m, (by.get(s.m) ?? 0) + s.w);
    openOdds(t('games.wheel'), [...by.entries()].sort((a, b) => b[0] - a[0]).map(([m, w]) => ({ label: m === 0 ? t('game.miss') : m < 1 ? t('game.partial') : m === 1 ? t('game.back') : t('game.win'), m, chance: w / WHEEL_TOTAL })), tableRtp(WHEEL), t('wheel.fair'));
  });

  // ── spin engine ──
  let angle = 0;            // current resting rotation (deg)
  let busy = false;
  let lead: Animation | null = null, leadStart = 0, leadFrom = 0;
  const LEAD = 900;         // deg/s while waiting for the server
  const CURVE = [0.2, 0.55, 0.1, 1] as const;
  const ease = bezier(...CURVE);
  const hap = tickHaptic();
  const boundaries = WHEEL.map((_, i) => wheelArc(i).from);
  const segAt = (wheelAngle: number) => { let k = 0; for (let i = 0; i < boundaries.length; i++) if (wheelAngle >= boundaries[i]) k = i; return k; };
  const underPointer = (R: number) => ((360 - (R % 360)) % 360 + 360) % 360;
  let raf = 0;

  const flick = () => { pointer.classList.remove('is-flick'); void pointer.offsetWidth; pointer.classList.add('is-flick'); };

  function startLead() {
    leadFrom = angle; leadStart = performance.now();
    if (reducedMotion) return;
    lead = rot.animate([{ transform: `rotate(${angle}deg)` }, { transform: `rotate(${angle + LEAD * 10}deg)` }], { duration: 10_000, easing: 'linear', fill: 'forwards' });
    let seg = segAt(underPointer(angle));
    const loop = () => {
      const R = leadFrom + (LEAD * (performance.now() - leadStart)) / 1000;
      const s = segAt(underPointer(R));
      if (s !== seg) { seg = s; sfx.peg(1); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }
  const leadAngle = () => (lead ? leadFrom + (LEAD * (performance.now() - leadStart)) / 1000 : angle);

  function land(index: number): Promise<void> {
    cancelAnimationFrame(raf);
    const from = leadAngle();
    lead?.cancel(); lead = null;
    const { from: a0, to: a1 } = wheelArc(index);
    const inside = a0 + (a1 - a0) * (0.2 + Math.random() * 0.6);
    let target = -inside;
    const turns = reducedMotion ? 1 : 4;
    while (target < from + turns * 360) target += 360;
    const delta = target - from;
    const D = reducedMotion ? 1200 : Math.max(4200, Math.min(6500, (delta * (CURVE[1] / CURVE[0]) / LEAD) * 1000));
    rot.style.transform = `rotate(${from}deg)`;
    const anim = rot.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${target}deg)` }], { duration: D, easing: `cubic-bezier(${CURVE.join(',')})`, fill: 'forwards' });
    const t0 = performance.now();
    let seg = segAt(underPointer(from)), prevR = from, prevT = t0;
    let hb = 0;
    const loop = (now: number) => {
      const k = Math.min(1, (now - t0) / D);
      const R = from + delta * ease(k);
      const v = (R - prevR) / Math.max(1, now - prevT) * 1000; // deg/s
      prevR = R; prevT = now;
      const s = segAt(underPointer(R));
      if (s !== seg) {
        seg = s;
        const speed = Math.min(1, v / LEAD);
        sfx.peg(speed); flick();
        if (speed < 0.35) hap(WHEEL[s].m >= 5);
        if (speed < 0.12 && now - hb > 520) { hb = now; sfx.heartbeat(0.7); }
      }
      if (k < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return anim.finished.then(() => {
      angle = ((target % 360) + 360) % 360;
      rot.style.transform = `rotate(${angle}deg)`;
      anim.cancel();
    }).catch(() => {});
  }

  async function spin() {
    if (busy) return;
    const bet = picker.get();
    if (picker.limit() === 0) { toast(t('game.paused'), 'info'); return; }
    if (store.balance.get() < bet) { needStars(); return; }
    busy = true;
    unlockAudio();
    tg.haptic.medium();
    tg.closingConfirmation(true);
    setFocus(true);
    page.classList.add('is-spinning'); picker.setDisabled(true); spinBtn.disabled = true;
    result.clear(); winPath.setAttribute('d', ''); stage.classList.remove('is-win', 'is-jackpot');
    ghost.setMood('watch'); ghost.antics(false);
    sfx.whoosh();
    store.balance.set(store.balance.get() - bet); // optimistic debit in the header; server balance replaces it on commit
    startLead();
    try {
      const r = await api.spin('wheel', bet);
      await land(r.index ?? 0);
      // reveal
      const s = WHEEL[r.index ?? 0];
      const { from: a0, to: a1 } = wheelArc(r.index ?? 0);
      const [x0, y0] = pt(a0, 92), [x1, y1] = pt(a1, 92);
      winPath.setAttribute('d', `M0 0L${f2(x0)} ${f2(y0)}A92 92 0 0 1 ${f2(x1)} ${f2(y1)}Z`);
      const rank = s.m >= 10 ? 4 : s.m >= 5 ? 3 : s.m >= 3 ? 2 : s.m > 1 ? 1 : 0;
      sfx.settle();
      if (r.payout > r.bet) {
        stage.classList.add('is-win'); if (s.m >= 5) stage.classList.add('is-jackpot');
        setTimeout(() => sfx.land(rank, s.m >= 10), 120);
        tg.haptic.success();
        ghost.setMood(s.m >= 3 ? 'ecstatic' : 'happy'); ghost.hop();
        if (s.m >= 2) burst(s.m);
      } else if (r.payout === r.bet) { sfx.land(0); ghost.setMood('happy'); }
      else { sfx.lose(); ghost.setMood('meh'); tg.haptic.soft(); }
      result.show(r.payout, r.bet, s.m);
      hist.push(s.m);
      api.commit();
    } catch (e) {
      cancelAnimationFrame(raf);
      const from = leadAngle(); lead?.cancel(); lead = null;
      const stop = rot.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${from + 140}deg)` }], { duration: 700, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
      await stop.finished.catch(() => {});
      angle = ((from + 140) % 360 + 360) % 360; rot.style.transform = `rotate(${angle}deg)`; stop.cancel();
      store.balance.set(store.balance.get() + bet);
      if (e instanceof ApiError && e.code === 'LIMIT') { toast(t('game.limit'), 'info'); void api.progress().catch(() => {}); }
      else if (e instanceof ApiError && e.code === 'NO_BALANCE') needStars();
      else toast(apiErrorText(e), 'err');
      ghost.setMood('idle');
    } finally {
      busy = false;
      setFocus(false);
      tg.closingConfirmation(false);
      page.classList.remove('is-spinning'); picker.setDisabled(false); spinBtn.disabled = false;
      ghost.antics(true);
      setTimeout(() => { if (!busy) ghost.setMood('idle'); }, 2600);
      renderBtn();
    }
  }
  spinBtn.addEventListener('click', spin);
  rot.addEventListener('click', spin);

  function burst(m: number) {
    const gold = ['#ffd66e', '#fff3c4', '#ff5ccc', '#3fe3ff', '#a65cff'];
    const cool = ['#3fe3ff', '#a65cff', '#ff5ccc', '#ffffff'];
    confetti(fx, { colors: m >= 5 ? gold : cool, count: m >= 10 ? 180 : m >= 5 ? 130 : 70, power: m >= 10 ? 1.35 : 1, y: 0.32 });
    if (m >= 5 && tier !== 'low') { flash.classList.remove('is-on'); void flash.offsetWidth; flash.classList.add('is-on'); }
  }

  return {
    el: page,
    onBack: () => !busy,
    destroy() { unBal(); picker.destroy(); bal.unsub(); cancelAnimationFrame(raf); lead?.cancel(); ghost.destroy(); },
  };
}
