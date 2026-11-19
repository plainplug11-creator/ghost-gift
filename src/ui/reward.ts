import { h, html, starIcon } from '../core/dom';
import { fmt } from '../core/i18n';
import { reducedMotion, tier } from '../core/perf';

/**
 * Reward celebration: "+N ★" pops out of the button, and a few ghost stars arc into the balance pill.
 * Transform/opacity WAAPI only, nodes pooled in one fixed layer; calm mode keeps just the label fade.
 */
let layer: HTMLElement | null = null;
const pool: HTMLElement[] = [];
const getLayer = () => (layer ??= document.body.appendChild(h('div', { class: 'rw-layer', 'aria-hidden': 'true' })));
const star = () => {
  const p = pool.pop();
  if (p) return p;
  const s = h('span', { class: 'rw-star' }); s.append(html(starIcon('star-ico')));
  return getLayer().appendChild(s);
};

function target(): DOMRect | null {
  const open = [...document.querySelectorAll<HTMLElement>('.sheet.is-open:not(.is-covered) .balance')].pop();
  const el = open ?? document.querySelector<HTMLElement>('.app:not(.is-covered) .topbar .balance');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width ? r : null;
}

export function flyReward(from: DOMRect | Element | null, amount: number, label?: string) {
  const r = from instanceof Element ? from.getBoundingClientRect() : from;
  if (!r) return;
  const L = getLayer();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  // floating label ('' = stars only, e.g. when the screen already shows the amount)
  if (label !== '') {
  const tag = h('span', { class: 'rw-tag' });
  tag.innerHTML = label ?? `+${fmt(amount)}${starIcon('star-ico')}`;
  tag.style.left = `${cx}px`; tag.style.top = `${cy}px`;
  L.append(tag);
  tag.animate(reducedMotion
    ? [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }]
    : [{ opacity: 0, transform: 'translate(-50%,-50%) translateY(6px) scale(.6)' }, { opacity: 1, transform: 'translate(-50%,-50%) translateY(-18px) scale(1.12)', offset: 0.25 },
      { opacity: 1, transform: 'translate(-50%,-50%) translateY(-30px) scale(1)', offset: 0.7 }, { opacity: 0, transform: 'translate(-50%,-50%) translateY(-46px) scale(.96)' }],
  { duration: 1300, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' }).finished.finally(() => tag.remove());
  }
  if (reducedMotion || amount <= 0) return;
  const to = target();
  if (!to) return;
  const tx = to.left + 18, ty = to.top + to.height / 2;
  const n = Math.min(tier === 'low' ? 4 : 9, 3 + Math.round(Math.log2(1 + amount)));
  for (let i = 0; i < n; i++) {
    const s = star();
    const sx = cx + (Math.random() - 0.5) * Math.min(80, r.width * 0.6), sy = cy + (Math.random() - 0.5) * 14;
    const dx = tx - sx, dy = ty - sy;
    const bend = (Math.random() - 0.5) * 120 - 40, lift = -60 - Math.random() * 50;
    s.style.left = `${sx}px`; s.style.top = `${sy}px`;
    s.animate([
      { transform: 'translate(-50%,-50%) translate(0,0) scale(.3)', opacity: 0 },
      { transform: `translate(-50%,-50%) translate(${(dx * 0.25 + bend * 0.6).toFixed(0)}px,${(lift).toFixed(0)}px) scale(1.15)`, opacity: 1, offset: 0.3 },
      { transform: `translate(-50%,-50%) translate(${(dx * 0.7 + bend * 0.3).toFixed(0)}px,${(dy * 0.55 + lift * 0.6).toFixed(0)}px) scale(.9)`, opacity: 1, offset: 0.7 },
      { transform: `translate(-50%,-50%) translate(${dx.toFixed(0)}px,${dy.toFixed(0)}px) scale(.45)`, opacity: 0.2 },
    ], { duration: 820 + i * 40, delay: 120 + i * 55, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'both' })
      .finished.finally(() => { s.style.left = '-99px'; pool.push(s); });
  }
}
