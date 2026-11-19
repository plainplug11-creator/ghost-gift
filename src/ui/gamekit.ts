import { flyReward } from './reward';
import { h, html, starIcon } from '../core/dom';
import { fmt, t } from '../core/i18n';
import { store } from '../core/store';
import { tg } from '../core/telegram';
import { GAME_BETS, type GameId } from '../api/games';
import { openSheet } from './sheet';
import { navigate } from './router';

/**
 * Shared pieces of the Wheel / Slots screens: bet picker (respects balance + the live bank limit),
 * result banner with count-up, history strip, a cubic-bezier solver (so JS knows the exact angle the
 * compositor is drawing) and a pooled confetti/spark burst.
 */

export function betPicker(game: GameId, onChange: (bet: number) => void) {
  const key = `gg.bet.${game}`;
  let bet = Number(localStorage.getItem(key)) || GAME_BETS[1];
  if (!(GAME_BETS as readonly number[]).includes(bet)) bet = GAME_BETS[1];
  const row = h('div', { class: 'bet-row', role: 'radiogroup', 'aria-label': t('game.bet') });
  const chips = GAME_BETS.map((b) => {
    const c = h('button', { class: 'bet-chip', 'data-press': '', 'data-haptic': 'select', role: 'radio' }, html(`${fmt(b)}${starIcon('star-ico')}`));
    c.addEventListener('click', () => { if (c.classList.contains('is-off')) return; set(b); });
    row.append(c);
    return c;
  });
  let ready = false;
  const set = (b: number) => {
    bet = b;
    try { localStorage.setItem(key, String(b)); } catch { /* private */ }
    chips.forEach((c, i) => { const on = GAME_BETS[i] === b; c.classList.toggle('is-on', on); c.setAttribute('aria-checked', String(on)); });
    if (ready) onChange(b);
  };
  const limit = () => store.progress.get()?.limits?.[game] ?? GAME_BETS[GAME_BETS.length - 1];
  const sync = () => {
    const lim = limit();
    chips.forEach((c, i) => c.classList.toggle('is-off', GAME_BETS[i] > lim));
    if (bet > lim && lim > 0) set([...GAME_BETS].reverse().find((b) => b <= lim)!);
    else set(bet);
  };
  const un = store.progress.sub(sync);
  sync();
  ready = true;
  return { el: row, get: () => bet, limit, destroy: un, setDisabled(d: boolean) { row.classList.toggle('is-locked', d); } };
}

/** Large payout line under the game: "+500 ⭐ · ×10" with a count-up. */
export function resultBanner() {
  const el = h('div', { class: 'gk-result', 'aria-live': 'polite' });
  let raf = 0;
  return {
    el,
    show(payout: number, bet: number, mult: number) {
      cancelAnimationFrame(raf);
      const win = payout > bet, back = payout === bet && payout > 0;
      el.className = `gk-result is-in ${win ? (mult >= 10 ? 'is-jackpot' : mult >= 3 ? 'is-big' : 'is-win') : back ? 'is-back' : 'is-lose'}`;
      if (!payout) { el.innerHTML = `<span class="gk-r-t">${t('game.lose')}</span>`; return; }
      el.innerHTML = `<span class="gk-r-x">×${mult}</span><span class="gk-r-v">+<b>0</b>${starIcon('star-ico')}</span>`;
      const b = el.querySelector('b')!;
      const t0 = performance.now(), D = Math.min(1400, 450 + payout * 2);
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
        b.textContent = fmt(Math.round(payout * e));
        if (k < 1) raf = requestAnimationFrame(step);
        else if (win) flyReward(b, payout, '');
      };
      raf = requestAnimationFrame(step);
    },
    hint(text: string) { cancelAnimationFrame(raf); el.className = 'gk-result is-in is-hint'; el.textContent = text; },
    clear() { cancelAnimationFrame(raf); el.className = 'gk-result'; },
  };
}

/** Last rounds as small chips (newest first). Kept per game in localStorage (display only). */
export function historyStrip(game: GameId) {
  const key = `gg.hist.${game}`;
  const el = h('div', { class: 'gk-hist', 'aria-label': t('game.history') });
  let list: number[] = [];
  try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch { list = []; }
  const render = () => {
    el.replaceChildren(...list.slice(0, 10).map((m, i) => h('span', { class: `gk-h ${m >= 10 ? 'm-jack' : m >= 3 ? 'm-big' : m > 1 ? 'm-win' : m === 1 ? 'm-back' : 'm-lose'}${i === 0 ? ' is-new' : ''}` }, `×${m}`)));
    el.hidden = !list.length;
  };
  render();
  return { el, push(m: number) { list = [m, ...list].slice(0, 20); try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* */ } render(); } };
}

/** Odds sheet: rows of multiplier → chance, plus the provably-fair note. */
export function openOdds(title: string, rows: { label: string; chance: number; m: number }[], rtp: number, note: string) {
  const list = h('div', { class: 'gk-odds' }, ...rows.map((r) => h('div', { class: `gk-odd ${r.m >= 10 ? 'm-jack' : r.m >= 3 ? 'm-big' : r.m > 1 ? 'm-win' : r.m === 1 ? 'm-back' : 'm-lose'}` },
    h('span', { class: 'gk-odd-l' }, r.label), h('span', { class: 'gk-odd-m' }, `×${r.m}`), h('span', { class: 'gk-odd-c' }, `${(r.chance * 100).toFixed(r.chance < 0.01 ? 2 : 1)}%`))));
  const fair = h('button', { class: 'btn-text', 'data-press': '' }, t('game.fairLink'));
  const s = openSheet([
    h('div', { class: 'sh-title' }, title),
    h('div', { class: 'gk-rtp' }, t('game.rtp', { p: (rtp * 100).toFixed(1) })),
    list,
    h('p', { class: 'gk-note' }, note),
    fair,
  ], { cls: 'sh gk-sheet' });
  fair.addEventListener('click', () => { void s.close(); navigate.push('legal', { id: 'fair' }); });
}

// ── cubic-bezier solver (same curve as the CSS/WAAPI easing) ──
export function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) { const d = dx(t); if (Math.abs(d) < 1e-6) break; t -= (sx(t) - x) / d; }
    t = Math.min(1, Math.max(0, t));
    return sy(t);
  };
}

/** Telegram haptic for each tick, rate-capped (iOS taptic engine dislikes > ~20/s). */
export function tickHaptic() {
  let last = 0;
  return (strong = false) => { const n = performance.now(); if (n - last < 55) return; last = n; strong ? tg.haptic.rigid() : tg.haptic.select(); };
}

/** "Not enough stars" → offer the top-up screen. */
export function needStars() {
  tg.haptic.warning();
  navigate.push('topup');
}
