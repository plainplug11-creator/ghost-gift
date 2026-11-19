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
import { SLOTS, SLOTS_TOTAL, SLOT_SYMS, tableRtp, type SlotSym } from '../api/games';
import { navBar } from '../ui/nav';
import { balancePill } from '../ui/header';
import { toast } from '../ui/sheet';
import { GHOST_FLAT } from '../ui/ghost';
import { ji } from '../art/games';
import { confetti } from '../ui/confetti';
import { betPicker, bezier, historyStrip, needStars, openOdds, resultBanner, tickHaptic } from '../ui/gamekit';
import type { Page } from '../ui/router';

const CELL = 78;           // px per symbol row
const STRIP = 18;          // symbols in the looping strip
const SPEED = 2200;        // px/s while spinning
const CURVE = [0.18, 0.62, 0.22, 1.06] as const; // slight overshoot = the reel "clunks" into place

const symHtml = (s: SlotSym) => s === 'ghost'
  ? `<span class="sl-sym s-ghost"><img src="${GHOST_FLAT}" alt="" draggable="false" decoding="async"></span>`
  : `<span class="sl-sym s-${s}">${ji(s === 'seven' ? 'seven' : s, 'sl-ji')}</span>`;
const rndSym = () => SLOT_SYMS[(Math.random() * SLOT_SYMS.length) | 0];

const PAYTABLE: { faces: SlotSym[]; m: number; id: string }[] = [
  { id: 'g3', faces: ['ghost', 'ghost', 'ghost'], m: 40 },
  { id: 's3', faces: ['seven', 'seven', 'seven'], m: 20 },
  { id: 'c3', faces: ['crown', 'crown', 'crown'], m: 10 },
  { id: 'd3', faces: ['diamond', 'diamond', 'diamond'], m: 5 },
  { id: 'f3', faces: ['leaf', 'acorn', 'heart'], m: 3 },
  { id: 'g2', faces: ['ghost', 'ghost'], m: 2 },
  { id: 'g1', faces: ['ghost'], m: 1 },
];

export function createSlots(): Page {
  const bal = balancePill(false);
  const odds = h('button', { class: 'gk-info', 'data-press': '', 'aria-label': t('game.odds') }, 'i');
  const fx = h('canvas', { class: 'gk-fx', 'aria-hidden': 'true' });
  const flash = h('div', { class: 'gk-flash', 'aria-hidden': 'true' });

  // reels: each has a strip of STRIP random symbols repeated twice (seamless loop) + a window of 3 rows
  const reels = [0, 1, 2].map(() => {
    const strip = h('div', { class: 'sl-strip' });
    const win = h('div', { class: 'sl-reel' }, strip);
    const syms: SlotSym[] = Array.from({ length: STRIP }, rndSym);
    strip.innerHTML = [...syms, ...syms].map(symHtml).join('');
    strip.style.transform = `translate3d(0, ${-CELL * 2}px, 0)`;
    return { win, strip, syms, loop: null as Animation | null, t0: 0, y: -CELL * 2 };
  });
  const lever = h('button', { class: 'sl-lever', 'data-press': '', 'aria-label': t('slots.spin') }, h('span', { class: 'sl-lever-arm' }, h('span', { class: 'sl-lever-ball' })));
  const marquee = h('div', { class: 'sl-marquee' }, h('span', { class: 'sl-title' }, 'GHOST SLOTS'), html(`<span class="sl-bulbs" aria-hidden="true">${'<i></i>'.repeat(14)}</span>`));
  const payline = h('span', { class: 'sl-line', 'aria-hidden': 'true' });
  const cabinet = h('div', { class: 'sl-cab' }, marquee, h('div', { class: 'sl-window' }, ...reels.map((r) => r.win), payline), lever);
  const banner = h('div', { class: 'sl-jackpot', 'aria-hidden': 'true' }, t('slots.jackpot'));
  const pay = h('div', { class: 'sl-pay' }, ...PAYTABLE.map((p) => h('div', { class: `sl-pay-row p-${p.id}` },
    html(`<span class="sl-pay-faces">${p.faces.map(symHtml).join('')}</span>`), h('span', { class: 'sl-pay-m' }, `×${p.m}`))));

  const result = resultBanner();
  const hist = historyStrip('slots');
  const spinBtn = h('button', { class: 'btn-primary gk-go', 'data-press': '' });
  const picker = betPicker('slots', () => renderBtn());
  function renderBtn() {
    const b = picker.get();
    spinBtn.replaceChildren(h('span', null, t('slots.spin')), html(`<span class="gk-price">${fmt(b)}${starIcon('star-ico')}</span>`));
    spinBtn.classList.toggle('is-short', store.balance.get() < b);
    if (picker.limit() === 0) result.hint(t('game.paused'));
  }
  const unBal = store.balance.sub(renderBtn);
  renderBtn();
  result.hint(t('slots.hint'));

  const page = h('div', { class: 'pg pg-game pg-slots' },
    navBar(t('games.slots'), odds, bal),
    h('div', { class: 'pg-scroll gk-scroll' },
      h('div', { class: 'sl-stage' }, cabinet, banner), result.el, hist.el,
      h('div', { class: 'gk-panel glass' }, h('div', { class: 'gk-label' }, t('game.bet')), picker.el, spinBtn),
      h('div', { class: 'gk-label gk-label-out' }, t('slots.paytable')), pay,
      h('p', { class: 'gk-foot' }, t('slots.foot')),
    ),
    fx, flash,
  );
  odds.addEventListener('click', () => openOdds(t('games.slots'),
    SLOTS.map((o) => ({ label: t(`slots.o.${o.id}` as never), m: o.m, chance: o.w / SLOTS_TOTAL })), tableRtp(SLOTS), t('slots.fair')));

  const ease = bezier(...CURVE);
  const hap = tickHaptic();
  const cycle = STRIP * CELL;
  let busy = false;
  let hum: () => void = () => {};

  function startLoops() {
    reels.forEach((r, i) => {
      r.win.classList.add('is-spin');
      if (reducedMotion) return;
      const from = -((((-r.y) % cycle) + cycle) % cycle);
      r.t0 = performance.now() + i * 90;
      r.loop = r.strip.animate([{ transform: `translate3d(0, ${from}px, 0)` }, { transform: `translate3d(0, ${from - cycle}px, 0)` }],
        { duration: (cycle / SPEED) * 1000, delay: i * 90, iterations: Infinity, easing: 'linear', fill: 'both' });
      (r as { from?: number }).from = from;
    });
  }
  const loopY = (r: typeof reels[number]) => {
    const from = (r as { from?: number }).from ?? r.y;
    const el = Math.max(0, performance.now() - r.t0);
    return from - ((SPEED * el) / 1000) % cycle;
  };

  /** Stop reel i on symbol `face` in the middle row. */
  function stopReel(i: number, face: SlotSym): Promise<void> {
    const r = reels[i];
    const cur = r.loop ? loopY(r) : r.y;
    r.loop?.cancel(); r.loop = null;
    // rebuild the strip so that the landing cell shows `face`, keeping the visible window unchanged
    const top = -((((-cur) % cycle) + cycle) % cycle); // same picture, offset inside (-cycle, 0]
    const travel = reducedMotion ? CELL * 3 : CELL * (9 + i * 3);
    let target = top - travel;
    target = Math.round(target / CELL) * CELL;         // snap to a cell
    // landing middle row index in the (extended) strip
    const midIdx = Math.round(-target / CELL) + 1;
    const need = midIdx + 3;
    const syms: SlotSym[] = [];
    for (let k = 0; k < need; k++) syms.push(r.syms[k % STRIP]);
    syms[midIdx] = face;
    syms[midIdx - 1] = rndSym(); syms[midIdx + 1] = rndSym();
    r.strip.innerHTML = syms.map(symHtml).join('');
    r.strip.style.transform = `translate3d(0, ${top}px, 0)`;
    const delta = top - target;
    const D = reducedMotion ? 500 : Math.max(650, Math.min(1500, (delta * (CURVE[1] / CURVE[0]) / SPEED) * 1000));
    const anim = r.strip.animate([{ transform: `translate3d(0, ${top}px, 0)` }, { transform: `translate3d(0, ${target}px, 0)` }], { duration: D, easing: `cubic-bezier(${CURVE.join(',')})`, fill: 'forwards' });
    // ticks as cells pass the payline
    const t0 = performance.now();
    let last = Math.floor(top / CELL);
    const loop = (now: number) => {
      const k = Math.min(1, (now - t0) / D);
      const y = top - delta * ease(k);
      const c = Math.floor(y / CELL);
      if (c !== last) { last = c; if (k > 0.55) { sfx.peg(1 - k); hap(); } }
      if (k < 1) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return anim.finished.then(() => {
      r.y = target; r.strip.style.transform = `translate3d(0, ${target}px, 0)`; anim.cancel();
      r.win.classList.remove('is-spin');
      // keep the strip short: normalise to the canonical layout with the face in the middle
      r.syms = Array.from({ length: STRIP }, rndSym);
      r.syms[3] = face; r.syms[2] = syms[midIdx - 1]; r.syms[4] = syms[midIdx + 1];
      r.strip.innerHTML = [...r.syms, ...r.syms].map(symHtml).join('');
      r.y = -CELL * 2; r.strip.style.transform = `translate3d(0, ${r.y}px, 0)`;
      sfx.reelStop(i); tg.haptic.rigid();
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
    lever.classList.remove('is-pull'); void lever.offsetWidth; lever.classList.add('is-pull');
    page.classList.add('is-spinning'); picker.setDisabled(true); spinBtn.disabled = true;
    cabinet.classList.remove('is-win', 'is-jackpot', 'is-big'); banner.classList.remove('is-on');
    reels.forEach((r) => r.win.querySelectorAll('.is-hit').forEach((x) => x.classList.remove('is-hit')));
    result.clear();
    sfx.whoosh();
    hum = sfx.spinHum(4);
    store.balance.set(store.balance.get() - bet);
    startLoops();
    const started = performance.now();
    try {
      const r = await api.spin('slots', bet);
      const faces = (r.faces ?? ['seven', 'crown', 'leaf']) as SlotSym[];
      const minRun = reducedMotion ? 0 : 900;
      const wait = Math.max(0, minRun - (performance.now() - started));
      await new Promise((res) => setTimeout(res, wait));
      // anticipation: two matching/ghost symbols on the first reels → the last reel spins longer
      const tease = !reducedMotion && (faces[0] === faces[1] || (faces[0] === 'ghost' && faces[1] === 'ghost'));
      await stopReel(0, faces[0]);
      await new Promise((res) => setTimeout(res, reducedMotion ? 0 : 120));
      await stopReel(1, faces[1]);
      if (tease) { cabinet.classList.add('is-tease'); sfx.heartbeat(1); await new Promise((res) => setTimeout(res, 650)); sfx.heartbeat(1.2); }
      await stopReel(2, faces[2]);
      cabinet.classList.remove('is-tease');
      hum();
      // reveal
      const m = r.mult;
      if (r.payout > 0) {
        reels.forEach((rl, i) => { if (r.outcome.startsWith('g') ? faces[i] === 'ghost' : true) rl.win.querySelectorAll('.sl-sym')[3]?.classList.add('is-hit'); });
      }
      if (r.payout > r.bet) {
        cabinet.classList.add('is-win'); if (m >= 10) cabinet.classList.add('is-big');
        const rank = m >= 40 ? 4 : m >= 10 ? 3 : m >= 5 ? 2 : 1;
        sfx.land(rank, m >= 40); tg.haptic.success();
        if (m >= 5) confetti(fx, { colors: ['#ffd66e', '#ff5ccc', '#3fe3ff', '#a65cff', '#fff'], count: m >= 40 ? 200 : m >= 10 ? 140 : 80, power: m >= 20 ? 1.3 : 1, y: 0.3 });
        if (m >= 20) { cabinet.classList.add('is-jackpot'); banner.classList.add('is-on'); if (tier !== 'low') { flash.classList.remove('is-on'); void flash.offsetWidth; flash.classList.add('is-on'); } }
      } else if (r.payout === r.bet) sfx.land(0);
      else { sfx.lose(); tg.haptic.soft(); }
      result.show(r.payout, r.bet, m);
      hist.push(m);
      api.commit();
    } catch (e) {
      hum();
      for (let i = 0; i < 3; i++) await stopReel(i, rndSym());
      store.balance.set(store.balance.get() + bet);
      if (e instanceof ApiError && e.code === 'LIMIT') { toast(t('game.limit'), 'info'); void api.progress().catch(() => {}); }
      else if (e instanceof ApiError && e.code === 'NO_BALANCE') needStars();
      else toast(apiErrorText(e), 'err');
    } finally {
      busy = false;
      setFocus(false);
      tg.closingConfirmation(false);
      page.classList.remove('is-spinning'); picker.setDisabled(false); spinBtn.disabled = false;
      renderBtn();
    }
  }
  spinBtn.addEventListener('click', spin);
  lever.addEventListener('click', spin);

  return {
    el: page,
    onBack: () => !busy,
    destroy() { unBal(); picker.destroy(); bal.unsub(); reels.forEach((r) => r.loop?.cancel()); hum(); },
  };
}
