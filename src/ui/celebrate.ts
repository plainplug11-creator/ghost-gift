import '../styles/meta.css';
import { h, html, starIcon } from '../core/dom';
import { fmt, t } from '../core/i18n';
import { tg } from '../core/telegram';
import { reducedMotion } from '../core/perf';
import { sfx } from '../core/sound';
import { ACHIEVEMENTS, GHOSTS, type AchId } from '../api/games';
import type { JellyIcon } from '../art/icon-names';
import { ji } from '../art/games';
import { GHOST_FLAT } from './ghost';
import { confetti } from './confetti';
import { pushBack, removeBack } from './router';

/** Level-up overlay: ring burst + count-up bonus. Tap / Back / 3.2 s closes it. */
export function levelUp(level: number, bonus: number) {
  const unlocked = GHOSTS.find((g) => g.level === level);
  const fx = h('canvas', { class: 'cel-fx', 'aria-hidden': 'true' });
  const val = h('b', null, '0');
  const card = h('div', { class: 'cel-card' },
    html(`<div class="cel-ring"><span class="cel-rays"></span><img src="${GHOST_FLAT}" alt="" style="filter:${unlocked?.filter || 'none'}"><span class="cel-lv">${level}</span></div>`),
    h('div', { class: 'cel-k' }, t('cel.level')),
    h('div', { class: 'cel-t' }, t('cel.levelN', { n: level })),
    bonus > 0 ? h('div', { class: 'cel-bonus' }, html('+'), val, html(starIcon('star-ico'))) : null,
    unlocked ? h('div', { class: 'cel-unlock' }, t('cel.ghost')) : null,
    h('div', { class: 'cel-tap' }, t('cel.tap')));
  const el = h('div', { class: 'cel', role: 'dialog', 'aria-live': 'assertive' }, h('div', { class: 'cel-bg' }), fx, card);
  document.body.append(el);
  void el.offsetWidth; el.classList.add('is-in');
  sfx.levelUp(); tg.haptic.success();
  requestAnimationFrame(() => confetti(fx, { colors: ['#3fe3ff', '#a65cff', '#ff5ccc', '#ffd66e', '#fff'], count: 120, y: 0.4 }));
  if (bonus > 0) {
    const t0 = performance.now(), D = reducedMotion ? 1 : 900;
    const step = (now: number) => { const k = Math.min(1, (now - t0) / D); val.textContent = fmt(Math.round(bonus * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
    setTimeout(() => requestAnimationFrame(step), 350);
  }
  let done = false;
  const close = () => { if (done) return; done = true; removeBack(close); el.classList.remove('is-in'); setTimeout(() => el.remove(), reducedMotion ? 0 : 420); };
  pushBack(close);
  el.addEventListener('click', close);
  setTimeout(close, 3600);
}

/** Achievement toasts: slide in one by one from the top. */
const queue: AchId[] = [];
let showing = false;
export function achievements(ids: AchId[]) { queue.push(...ids); if (!showing) next(); }
function next() {
  const id = queue.shift();
  if (!id) { showing = false; return; }
  showing = true;
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  const el = h('div', { class: 'ach-toast', role: 'status' },
    html(`<span class="ach-ico">${ji((a?.icon ?? 'cup') as JellyIcon)}</span>`),
    h('span', { class: 'ach-t' }, h('small', null, t('cel.ach')), h('b', null, t(`ach.${id}` as never))),
    h('span', { class: 'ach-xp' }, `+${a?.xp ?? 0} XP`));
  document.body.append(el);
  void el.offsetWidth; el.classList.add('is-in');
  sfx.claim(); tg.haptic.success();
  setTimeout(() => { el.classList.remove('is-in'); setTimeout(() => { el.remove(); next(); }, 420); }, 2600);
}
