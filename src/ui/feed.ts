import { h, html, starIcon } from '../core/dom';
import { t, fmt, type I18nKey } from '../core/i18n';
import { ji } from '../art/games';
import type { JellyIcon } from '../art/icon-names';
import { isRunning, onRunningChange, reducedMotion } from '../core/perf';

/**
 * Live wins feed — a JS-driven, recycling marquee.
 *  - Only ~6–8 chips exist in the DOM at any time (chips leaving on the left are
 *    removed, new ones are appended on the right) → constant memory, cheap layout.
 *  - Movement is a single translate3d on the track (compositor only).
 *  - Touch: eases to a stop, lets you drag/scrub, then eases back to speed.
 *  - New wins (mock generator now, WebSocket later) are queued and enter next.
 */

type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
export interface Win { nick: string; item: I18nKey; icon?: JellyIcon; stars?: number; rarity: Rarity; me?: boolean }

const NICKS = ['lera_mur', 'Дима', 'kostya.ua', 'Настя', 'maks_k', 'Оля', 'sasha', 'vlad_off', 'Kate', 'Артём', 'yulia.b', 'Ира', 'den4ik', 'Mira', 'Тимур', 'nikita07', 'Ann', 'Богдан'];
const ITEMS: { item: I18nKey; icon?: JellyIcon; stars?: number[]; rarity: Rarity; w: number }[] = [
  { item: 'item.stars', stars: [25, 50, 75, 100, 150], rarity: 'common', w: 20 },
  { item: 'item.heart', icon: 'heart', rarity: 'common', w: 12 },
  { item: 'item.bear', icon: 'bear', rarity: 'common', w: 12 },
  { item: 'item.rose', icon: 'rose', rarity: 'rare', w: 9 },
  { item: 'item.gift', icon: 'gift', rarity: 'rare', w: 9 },
  { item: 'item.cake', icon: 'cake', rarity: 'rare', w: 6 },
  { item: 'item.stars', stars: [500, 1000], rarity: 'epic', w: 5 },
  { item: 'item.rocket', icon: 'rocket', rarity: 'epic', w: 5 },
  { item: 'item.cup', icon: 'cup', rarity: 'epic', w: 4 },
  { item: 'item.ring', icon: 'ring', rarity: 'legendary', w: 3 },
  { item: 'item.premium', icon: 'crown', rarity: 'legendary', w: 2 },
  { item: 'item.diamond', icon: 'diamond', rarity: 'mythic', w: 1 },
];
const TOTAL_W = ITEMS.reduce((s, i) => s + i.w, 0);
const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];

export function mockWin(): Win {
  let r = Math.random() * TOTAL_W;
  const it = ITEMS.find((i) => (r -= i.w) < 0) ?? ITEMS[0];
  return { nick: pick(NICKS), item: it.item, icon: it.icon, stars: it.stars && pick(it.stars), rarity: it.rarity };
}

function chip(w: Win, isNew = false) {
  const ico = w.stars ? starIcon('star-ico') : ji(w.icon!);
  const label = w.stars ? t('item.stars', { n: fmt(w.stars) }) : t(w.item);
  const el = h('div', { class: `chip r-${w.rarity}${isNew ? ' is-new' : ''}${w.me ? ' is-me' : ''}` });
  // epic+ chips get a moving shine sweep (desynced per chip)
  if (w.rarity !== 'common' && w.rarity !== 'rare') el.style.setProperty('--sd', `${(Math.random() * 3).toFixed(2)}s`);
  el.append(html(`<span class="chip-ico">${ico}</span>`));
  const text = h('span', { class: 'chip-text' }, h('span', { class: 'chip-nick' }, w.nick), h('span', { class: 'chip-item' }, label));
  el.append(text);
  return el;
}

const GAP = 8;
const SPEED = 30; // px/s — calm, readable

export function createFeed() {
  const root = h('section', { class: 'feed', 'aria-label': t('feed.label') });
  const track = h('div', { class: 'feed-track' });
  root.append(track);

  type Node = { el: HTMLElement; w: number; data: Win };
  const nodes: Node[] = [];
  const history: Win[] = [];          // chips that scrolled off the left (for drag-back)
  const queue: Win[] = [];            // fresh wins waiting to enter
  const pool: Win[] = Array.from({ length: 14 }, mockWin); // seamless loop source
  let poolIdx = 0;

  let x = 0, v = reducedMotion ? 0 : SPEED, target = v;
  let viewW = 0, raf = 0, last = 0, held = false, dragX = 0, resumeT = 0, active = true;

  const measure = (n: Node) => (n.w = n.el.offsetWidth);
  const totalW = () => nodes.reduce((s, n) => s + n.w + GAP, 0);
  const nextData = (): [Win, boolean] => {
    const q = queue.shift();
    if (q) { pool[poolIdx % pool.length] = q; return [q, true]; }
    return [pool[poolIdx++ % pool.length], false];
  };
  const append = () => {
    const [d, fresh] = nextData();
    const n: Node = { el: chip(d, fresh), w: 0, data: d };
    track.append(n.el); measure(n); nodes.push(n);
  };
  const fill = () => { while (x + totalW() < viewW + 160) append(); };

  const render = () => { track.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`; };

  const recycle = () => {
    // left overflow → drop first chip
    while (nodes.length && x + nodes[0].w + GAP < 0) {
      const n = nodes.shift()!;
      x += n.w + GAP; n.el.remove(); history.push(n.data);
      if (history.length > 30) history.shift();
    }
    // dragged right past the start → bring back previous chips
    while (x > 0 && history.length) {
      const d = history.pop()!;
      const n: Node = { el: chip(d), w: 0, data: d };
      track.prepend(n.el); measure(n); nodes.unshift(n); x -= n.w + GAP;
    }
    if (x > 0) x = 0;
    fill();
    // trim right side to keep DOM small
    while (nodes.length > 2 && x + totalW() - (nodes[nodes.length - 1].w + GAP) > viewW + 360) nodes.pop()!.el.remove();
  };

  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!held && resumeT && now > resumeT) { target = reducedMotion ? 0 : SPEED; resumeT = 0; }
    v += (target - v) * Math.min(1, dt * 4); // critically-damped-ish ease to target speed
    if (!held) x -= v * dt;
    recycle(); render();
    raf = requestAnimationFrame(frame);
  };
  const start = () => { if (!raf && active && isRunning()) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };

  // touch: hold to pause, drag to scrub
  root.addEventListener('pointerdown', (e) => {
    held = true; target = 0; v = 0; dragX = e.clientX; resumeT = 0;
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove', (e) => {
    if (!held) return;
    x += e.clientX - dragX; dragX = e.clientX;
    if (!raf) { recycle(); render(); }
  });
  const up = () => { if (!held) return; held = false; resumeT = performance.now() + 900; };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);

  // mock "server" pushing new wins
  let timer = 0;
  const schedule = () => {
    timer = window.setTimeout(() => { if (isRunning()) queue.push(mockWin()); if (queue.length > 4) queue.shift(); schedule(); }, 2200 + Math.random() * 3800);
  };

  const ro = new ResizeObserver(() => { viewW = root.clientWidth; nodes.forEach(measure); fill(); render(); });

  onRunningChange((r) => (r ? start() : stop()));

  return {
    el: root,
    mount() {
      viewW = root.clientWidth; fill(); render(); ro.observe(root);
      schedule(); start();
    },
    setActive(a: boolean) { active = a; a ? start() : stop(); },
    /** Real-time win (own or from the server stream) → jumps the queue. */
    push(w: Win) { queue.unshift(w); },
    destroy() { stop(); clearTimeout(timer); ro.disconnect(); },
  };
}
