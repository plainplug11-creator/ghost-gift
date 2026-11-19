import { h, html, starIcon } from '../core/dom';
import { t, fmt, type I18nKey } from '../core/i18n';
import { ji } from '../art/games';
import type { JellyIcon } from '../art/icon-names';
import { isRunning, onRunningChange, reducedMotion } from '../core/perf';

/**
 * Live wins feed — a recycling marquee.
 *  - Only ~6–8 chips exist in the DOM at any time (chips leaving on the left are
 *    removed, new ones are appended on the right) → constant memory, cheap layout.
 *  - Movement is a single translate3d on the track, run as WAAPI segments (one chip width each) on the
 *    compositor — JS only wakes up between segments to recycle chips, so there is no per-frame rAF work.
 *  - Touch: eases to a stop, lets you drag/scrub, then eases back to speed.
 *  - New wins (mock generator now, WebSocket later) are queued and enter next.
 */

type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
export interface Win { nick: string; item: I18nKey; icon?: JellyIcon; stars?: number; rarity: Rarity; me?: boolean; id?: number; showcase?: boolean; note?: string; at?: number; live?: string }

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

/** Honest filler when there are few real wins: "in the cases" prize showcase — no invented players. */
export function showcaseWin(i: number): Win {
  const pool = ITEMS.filter((x) => x.rarity !== 'common');
  const it = pool[i % pool.length];
  return { nick: t('feed.inCases'), item: it.item, icon: it.icon, stars: it.stars && it.stars[it.stars.length - 1], rarity: it.rarity, showcase: true };
}

export function mockWin(): Win {
  let r = Math.random() * TOTAL_W;
  const it = ITEMS.find((i) => (r -= i.w) < 0) ?? ITEMS[0];
  return { nick: pick(NICKS), item: it.item, icon: it.icon, stars: it.stars && pick(it.stars), rarity: it.rarity };
}

/** "5 мин" / "2 ч" — real age of a server win, computed when the chip enters (no fake timestamps). */
function ago(at: number) {
  const m = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (m < 1) return t('feed.now');
  if (m < 60) return t('feed.agoM', { n: m });
  const hh = Math.round(m / 60);
  return hh < 24 ? t('feed.agoH', { n: hh }) : t('feed.agoD', { n: Math.round(hh / 24) });
}

function chip(w: Win, isNew = false) {
  if (w.live) {
    const el = h('div', { class: 'chip chip-live' });
    el.append(html('<span class="chip-ico"><i class="live-dot"></i></span>'), h('span', { class: 'chip-text' }, h('span', { class: 'chip-nick' }, t('feed.live')), h('span', { class: 'chip-item' }, w.live)));
    return el;
  }
  const ico = w.stars ? starIcon('star-ico') : ji(w.icon!);
  const label = w.stars ? t('item.stars', { n: fmt(w.stars) }) : t(w.item);
  const el = h('div', { class: `chip r-${w.rarity}${isNew ? ' is-new' : ''}${w.me ? ' is-me' : ''}${w.showcase ? ' is-showcase' : ''}` });
  // epic+ chips get a moving shine sweep (desynced per chip)
  if (w.rarity !== 'common' && w.rarity !== 'rare') el.style.setProperty('--sd', `${(Math.random() * 3).toFixed(2)}s`);
  el.append(html(`<span class="chip-ico">${ico}</span>`));
  const text = h('span', { class: 'chip-text' }, h('span', { class: 'chip-nick' }, w.nick), h('span', { class: 'chip-item' }, [label, w.note, w.at ? ago(w.at) : ''].filter(Boolean).join(' · ')));
  el.append(text);
  return el;
}

const GAP = 8;
const SPEED = 30; // px/s — calm, readable

export function createFeed(opts: { demo?: boolean } = {}) {
  const demo = opts.demo !== false;
  const root = h('section', { class: 'feed', 'aria-label': t('feed.label') });
  const track = h('div', { class: 'feed-track' });
  root.append(track);

  type Node = { el: HTMLElement; w: number; data: Win };
  const nodes: Node[] = [];
  const history: Win[] = [];          // chips that scrolled off the left (for drag-back)
  const queue: Win[] = [];            // fresh wins waiting to enter
  // seamless loop source: demo generator locally, honest prize showcase in production until real wins arrive
  let liveChip: Win | null = null;
  const pool: Win[] = demo ? Array.from({ length: 14 }, mockWin) : Array.from({ length: 10 }, (_, i) => showcaseWin(i));
  let poolIdx = 0;

  let x = 0;
  let viewW = 0, held = false, dragX = 0, resumeT = 0, active = true;
  let seg: Animation | null = null, segDist = 0;

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
  const fill = () => { while (x + totalW() < viewW + 320) append(); };

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
    while (nodes.length > 2 && x + totalW() - (nodes[nodes.length - 1].w + GAP) > viewW + 480) nodes.pop()!.el.remove();
  };

  const curX = () => { try { return new DOMMatrixReadOnly(getComputedStyle(track).transform).m41; } catch { return x; } };
  /** one compositor segment: until the first chip has fully left (ramp = ease up from standstill after a touch) */
  const runSeg = (ramp = false) => {
    if (seg || held || !active || reducedMotion || !isRunning() || !nodes.length) return;
    recycle(); render();
    let dist = x + nodes[0].w + GAP;
    if (dist < 2) dist = nodes[0].w + GAP;
    if (ramp) dist = Math.min(dist, 34);
    segDist = dist;
    const dur = ((ramp ? 2 : 1) * dist / SPEED) * 1000;
    const a = track.animate([{ transform: `translate3d(${x.toFixed(2)}px,0,0)` }, { transform: `translate3d(${(x - dist).toFixed(2)}px,0,0)` }],
      { duration: dur, easing: ramp ? 'cubic-bezier(.5,0,.75,.5)' : 'linear', fill: 'forwards' });
    seg = a;
    a.onfinish = () => { if (seg !== a) return; x -= segDist; seg = null; render(); a.cancel(); runSeg(); };
  };
  const start = (ramp = false) => runSeg(ramp);
  const stop = () => { if (!seg) return; const a = seg; seg = null; x = curX(); render(); a.cancel(); };

  // touch: hold to pause, drag to scrub
  root.addEventListener('pointerdown', (e) => {
    held = true; stop(); clearTimeout(resumeT); dragX = e.clientX;
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove', (e) => {
    if (!held) return;
    x += e.clientX - dragX; dragX = e.clientX;
    recycle(); render();
  });
  const up = () => { if (!held) return; held = false; clearTimeout(resumeT); resumeT = window.setTimeout(() => start(true), 900); };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);

  // mock "server" pushing new wins
  let timer = 0;
  const schedule = () => {
    timer = window.setTimeout(() => { if (isRunning()) queue.push(mockWin()); if (queue.length > 4) queue.shift(); schedule(); }, 2200 + Math.random() * 3800);
  };

  const ro = new ResizeObserver(() => { viewW = root.clientWidth; nodes.forEach(measure); fill(); render(); });

  onRunningChange((r) => (r ? start(true) : stop()));

  return {
    el: root,
    mount() {
      viewW = root.clientWidth; fill(); render(); ro.observe(root);
      if (demo) schedule();
      start();
    },
    setActive(a: boolean) { active = a; a ? start(true) : stop(); },
    /** Real-time win (own or from the server stream) → jumps the queue. */
    push(w: Win) { queue.unshift(w); },
    /** Real recent wins from the server (newest first). Fills the loop; pads with showcase chips if there are few. */
    setReal(list: Win[], fresh: Win[] = []) {
      const loop = list.slice(0, 20);
      for (let i = 0; loop.length < 8; i++) loop.push(showcaseWin(i));
      if (liveChip) loop.unshift(liveChip); // the activity line enters next (poolIdx resets below)
      pool.splice(0, pool.length, ...loop); poolIdx = 0;
      // first real data while only showcase chips are on screen → swap them in right away (soft fade), not after a full loop
      if (list.length && nodes.length && nodes.every((n) => n.data.showcase)) {
        const wasRunning = !!seg; stop();
        nodes.splice(0).forEach((n) => n.el.remove()); x = 0; fill(); render();
        track.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: 'ease-out' });
        if (wasRunning) start();
      }
      for (const f of fresh.reverse()) queue.push(f);
      while (queue.length > 6) queue.shift();
    },
    /** Real 24h activity → one honest "live" chip in the loop (only once there is something to say). */
    setStats(plays: number, players: number) {
      liveChip = plays >= 3 ? { nick: '', item: 'feed.live', rarity: 'common', live: t('feed.liveStat', { n: fmt(plays), p: fmt(players) }) } : null;
    },
    destroy() { stop(); clearTimeout(timer); clearTimeout(resumeT); ro.disconnect(); },
  };
}
