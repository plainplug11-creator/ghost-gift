import '../styles/meta.css';
import { h, html } from '../core/dom';
import { t } from '../core/i18n';
import { tg } from '../core/telegram';
import { reducedMotion } from '../core/perf';
import { ji } from '../art/games';
import { GHOST_FLAT } from './ghost';
import { pushBack, removeBack } from './router';

const KEY = 'gg.onb';
/** First-run intro: 4 swipeable cards with the mascot. Shown once (CloudStorage-independent, local flag). */
export function shouldOnboard() { try { return localStorage.getItem(KEY) !== '1'; } catch { return false; } }

export function showOnboarding(force = false) {
  if (!force && !shouldOnboard()) return;
  const slides = [
    { art: `<img class="onb-ghost" src="${GHOST_FLAT}" alt="">`, k: 1 },
    { art: `<span class="onb-trio">${ji('gift')}${ji('crown')}${ji('diamond')}</span>`, k: 2 },
    { art: `<span class="onb-trio">${ji('luck')}${ji('seven')}${ji('spins')}</span>`, k: 3 },
    { art: `<span class="onb-trio">${ji('leaf')}${ji('cup')}${ji('heart')}</span>`, k: 4 },
  ];
  let i = 0;
  const track = h('div', { class: 'onb-track' }, ...slides.map((s) => h('div', { class: 'onb-slide' },
    html(`<div class="onb-art">${s.art}</div>`),
    h('div', { class: 'onb-t' }, t(`onb.t${s.k}` as never)),
    h('div', { class: 'onb-d' }, t(`onb.d${s.k}` as never)))));
  const dots = h('div', { class: 'onb-dots' }, ...slides.map(() => h('i')));
  const nextBtn = h('button', { class: 'btn-primary onb-next', 'data-press': '' });
  const skip = h('button', { class: 'onb-skip', 'data-press': '' }, t('onb.skip'));
  const el = h('div', { class: 'onb', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'onb-bg' }), skip, h('div', { class: 'onb-view' }, track), dots, nextBtn);
  const go = (n: number) => {
    i = Math.max(0, Math.min(slides.length - 1, n));
    track.style.transform = `translate3d(${-i * 100}%, 0, 0)`;
    [...dots.children].forEach((d, k) => d.classList.toggle('is-on', k === i));
    [...track.children].forEach((s, k) => s.classList.toggle('is-on', k === i));
    nextBtn.textContent = i === slides.length - 1 ? t('onb.start') : t('onb.next');
  };
  const close = () => {
    try { localStorage.setItem(KEY, '1'); } catch { /* */ }
    removeBack(close); el.classList.remove('is-in');
    setTimeout(() => el.remove(), reducedMotion ? 0 : 450);
  };
  nextBtn.addEventListener('click', () => { tg.haptic.tap(); i === slides.length - 1 ? close() : go(i + 1); });
  skip.addEventListener('click', close);
  // swipe
  let x0 = 0, dx = 0, drag = false;
  const view = el.querySelector('.onb-view') as HTMLElement;
  view.addEventListener('pointerdown', (e) => { drag = true; x0 = e.clientX; dx = 0; track.style.transition = 'none'; });
  view.addEventListener('pointermove', (e) => { if (!drag) return; dx = e.clientX - x0; track.style.transform = `translate3d(calc(${-i * 100}% + ${dx}px), 0, 0)`; });
  const end = () => { if (!drag) return; drag = false; track.style.transition = ''; if (Math.abs(dx) > 50) { tg.haptic.select(); go(i + (dx < 0 ? 1 : -1)); } else go(i); };
  view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
  pushBack(close);
  document.body.append(el);
  go(0);
  void el.offsetWidth; el.classList.add('is-in');
}
