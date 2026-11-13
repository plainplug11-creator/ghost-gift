import { h } from '../core/dom';
import { tier, reducedMotion, isRunning } from '../core/perf';
import meta from '../assets/ghost/meta.json';
import '../styles/ghost.css';

/**
 * The Ghost Gift mascot, assembled from layers cut out of the key art
 * (ghost-gift-media/ghost2/build.py): orbit-ring loops behind the body, tail
 * wisp, glass body, arms, chest star and the sparkles as separate images; the
 * glowing visor eyes are live SVG so they can blink, look around and emote.
 * Everything animates with transform/opacity only; low tier / reduced motion
 * gets a still pose.
 */
export type GhostMood = 'idle' | 'watch' | 'lean' | 'gasp' | 'meh' | 'happy' | 'ecstatic';

// layers exported at two sizes (ghost-layers.py): 384px frame for the perch (≤ 92 css px × 3 dpr), 192px for the 44px logo
const urls = import.meta.glob('../assets/ghost/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const urlsM = import.meta.glob('../assets/ghost/m/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
let mini = false;
const url = (n: string) => (mini && urlsM[`../assets/ghost/m/${n}.webp`]) || urls[`../assets/ghost/${n}.webp`];
export const GHOST_FLAT = urls['../assets/ghost/flat-192.webp'];

type L = { x: number; y: number; w: number; h: number; ox?: number; oy?: number };
const LY = meta.layers as Record<string, L>;
const box = (l: L) => `left:${l.x.toFixed(2)}%;top:${l.y.toFixed(2)}%;width:${l.w.toFixed(2)}%;height:${l.h.toFixed(2)}%;transform-origin:${(l.ox ?? 50).toFixed(1)}% ${(l.oy ?? 50).toFixed(1)}%`;
const img = (n: string, cls: string) => `<img class="gh-l ${cls}" src="${url(n)}" style="${box(LY[n])}" alt="" draggable="false" decoding="async">`;
/** limb in a wrapper: the wrapper takes one-shot follow-through (WAAPI), the image keeps its CSS sway loop */
const limb = (n: string, cls: string) => { const l = LY[n], o = `${(l.ox ?? 50).toFixed(1)}% ${(l.oy ?? 50).toFixed(1)}%`;
  return `<div class="gh-lw ${cls}w" style="${box(l)}"><img class="gh-l ${cls}" src="${url(n)}" style="inset:0;width:100%;height:100%;transform-origin:${o}" alt="" draggable="false" decoding="async"></div>`; };

const SPARKS = Object.keys(LY).filter((k) => /^sp\d+$/.test(k));

// Visor eyes: one HTML box per eye (so blink / glow / mood transforms stay on the compositor — animating
// SVG children would force main-thread style+paint every frame), each holding a tiny SVG for the shapes.
function eyesHtml() {
  const e = meta.eyes.map((m) => {
    const cx = m.cx * 10, cy = m.cy * 10, rx = m.w * 5, ry = m.h * 5, r = m.rot - 180;
    const bw = rx * 4.4, bh = ry * 3.4, f = (n: number) => n.toFixed(1);
    const vb = `${f(-bw / 2)} ${f(-bh / 2)} ${f(bw)} ${f(bh)}`;
    const arc = `M${f(-rx * 1.05)} ${f(ry * 0.25)} Q0 ${f(-ry * 0.9)} ${f(rx * 1.05)} ${f(ry * 0.25)}`;
    const star = `M0 ${f(-ry * 1.1)} Q${f(rx * 0.16)} ${f(-rx * 0.16)} ${f(rx * 1.25)} 0 Q${f(rx * 0.16)} ${f(rx * 0.16)} 0 ${f(ry * 1.1)} Q${f(-rx * 0.16)} ${f(rx * 0.16)} ${f(-rx * 1.25)} 0 Q${f(-rx * 0.16)} ${f(-rx * 0.16)} 0 ${f(-ry * 1.1)}Z`;
    return `<div class="ge-eye" style="left:${f((cx - bw / 2) / 10)}%;top:${f((cy - bh / 2) / 10)}%;width:${f(bw / 10)}%;height:${f(bh / 10)}%;transform:rotate(${f(r)}deg)"><div class="ge-lid"><div class="ge-x"><div class="ge-s">
      <i class="ge-halo" style="width:${f((rx * 4) / bw * 100)}%;height:${f((ry * 3.1) / bh * 100)}%"></i>
      <svg class="ge-svg" viewBox="${vb}" aria-hidden="true">
        <g class="ge-open"><ellipse rx="${f(rx + 4)}" ry="${f(ry + 4)}" fill="#8f52ff"/><ellipse rx="${f(rx)}" ry="${f(ry)}" fill="url(#geCore)"/>
          <ellipse cx="${f(-rx * 0.28)}" cy="${f(-ry * 0.38)}" rx="${f(rx * 0.26)}" ry="${f(ry * 0.16)}" fill="#fff" opacity=".95"/></g>
        <g class="ge-hap" fill="none" stroke-linecap="round"><path d="${arc}" stroke="#ff7ad9" stroke-opacity=".55" stroke-width="${f(rx * 1.15)}"/><path d="${arc}" stroke="#fff3fc" stroke-width="${f(rx * 0.62)}"/></g>
      </svg>
      <div class="ge-star"><svg class="ge-svg" viewBox="${vb}" aria-hidden="true"><path d="${star}" fill="#fff" stroke="#ff7ad9" stroke-width="6" stroke-linejoin="round"/></svg></div>
    </div></div></div></div>`;
  }).join('');
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><radialGradient id="geCore" cx=".42" cy=".36" r=".72"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#ffd6f4"/><stop offset="1" stop-color="#ff86df"/></radialGradient></defs></svg>
    <div class="gh-eyes"><div class="ge-look">${e}</div></div>`;
}

export interface Ghost {
  el: HTMLElement;
  setMood(m: GhostMood): void;
  /** gaze in face units (≈ -11..11); the whole body turns/leans a little toward it too */
  lookAt(x: number, y: number): void;
  flick(): void;
  /** one-shot reactions */
  pop(): void;
  hop(): void;
  /** pause/resume the random idle antics (e.g. while the reel spins) */
  antics(on: boolean): void;
  destroy(): void;
}

type Act = 'stretch' | 'yawn' | 'wave' | 'spin' | 'peek' | 'flinch';

export function createGhost(opts: { mini?: boolean; cls?: string } = {}): Ghost {
  const lite = tier === 'low' || reducedMotion;
  mini = !!opts.mini;
  const r = meta.ring, star = LY.star;
  const orb = (side: 'back' | 'front') => opts.mini || lite ? '' :
    `<div class="gh-orb ${side}" style="left:${(r.cx - r.rx).toFixed(2)}%;top:${(r.cy - r.rx).toFixed(2)}%;width:${(r.rx * 2).toFixed(2)}%;height:${(r.rx * 2).toFixed(2)}%;transform:rotate(${r.rot}deg) scaleY(${(r.ry / r.rx).toFixed(4)})"><div class="gh-orb-spin"><i></i><i></i><i></i></div></div>`;
  const el = h('div', { class: `gh${opts.mini ? ' is-mini' : ''}${lite ? ' is-lite' : ''} ${opts.cls ?? ''}`, 'data-mood': 'idle' });
  // float (CSS loop) → turn (toward the gaze, transition) → act (WAAPI one-shots) → body squash (CSS) → squash one-shots (WAAPI)
  el.innerHTML = `<div class="gh-float"><div class="gh-turn"><div class="gh-act">
      <div class="gh-back">${img('ringL', 'gh-ringL')}${img('ringR', 'gh-ringR')}</div>${orb('back')}
      <div class="gh-sq"><div class="gh-sqx">${limb('tail', 'gh-tail')}${img('core', 'gh-core')}${limb('armL', 'gh-armL')}${limb('armR', 'gh-armR')}${eyesHtml()}
        <div class="gh-starw" style="${box(star)}"><div class="gh-star"><i class="gh-star-glow"></i><img src="${url('star')}" alt="" draggable="false" decoding="async"></div></div></div></div>${orb('front')}
    </div></div></div>
    <div class="gh-sps">${SPARKS.map((k, i) => `<span class="gh-sp" style="${box(LY[k])};--dl:${(-i * 0.73).toFixed(2)}s;--d:${(2.4 + (i % 4) * 0.45).toFixed(2)}s"><img src="${url(k)}" alt="" draggable="false" decoding="async"></span>`).join('')}</div>`;
  const $ = (q: string) => el.querySelector(q) as HTMLElement;
  const look = $('.ge-look'), starEl = $('.gh-starw'), sqx = $('.gh-sqx'), act = $('.gh-act'), turn = $('.gh-turn'), sps = $('.gh-sps');
  const armL = $('.gh-armLw'), armR = $('.gh-armRw'), tail = $('.gh-tailw');
  const eyes = Array.from(el.querySelectorAll<HTMLElement>('.ge-x'));
  let gx = 0, gy = 0, mood: GhostMood = 'idle', lastFlick = 0, anticsOn = true, idleT = 0, busyUntil = 0;
  const live = !lite;
  const anim = (t: Element, k: Keyframe[], o: KeyframeAnimationOptions) => (live ? t.animate(k, { composite: 'replace', ...o }) : null);
  const E = { spring: 'cubic-bezier(.34,1.56,.64,1)', out: 'cubic-bezier(.22,1,.36,1)', io: 'cubic-bezier(.45,0,.55,1)' };
  const tr = (x: number, y: number) => `translate(${(x * 0.23).toFixed(2)}%,${(y * 0.23).toFixed(2)}%)`;
  const apply = () => {
    look.style.transform = tr(gx, gy);
    // body turns toward what it looks at: lean + slight shear reads as a 3/4 turn
    turn.style.transform = `translate(${(gx * 0.35).toFixed(2)}%,${(Math.max(0, gy) * 0.2).toFixed(2)}%) rotate(${(gx * 0.55).toFixed(2)}deg) skewX(${(-gx * 0.3).toFixed(2)}deg)`;
  };
  /** arms/tail drag behind a body move and settle with overshoot */
  function follow(dir: number, k = 1, delay = 70) {
    const a = 9 * k * dir;
    for (const [t, m, d] of [[armL, 1, delay], [armR, 1, delay + 30], [tail, -1.2, delay + 60]] as const)
      anim(t, [{ transform: 'none' }, { transform: `rotate(${(-a * m).toFixed(1)}deg)`, offset: 0.35 }, { transform: `rotate(${(a * m * 0.35).toFixed(1)}deg)`, offset: 0.7 }, { transform: 'none' }], { duration: 760, delay: d, easing: E.io });
  }
  function lookAt(x: number, y: number) {
    const nx = Math.max(-11, Math.min(11, x)), dx = nx - gx;
    gx = nx; gy = Math.max(-8, Math.min(9, y)); apply();
    if (Math.abs(dx) > 4) follow(Math.sign(dx), Math.min(1, Math.abs(dx) / 10));
  }
  function flick() {
    if (!live) return;
    const now = performance.now(); if (now - lastFlick < 90) return; lastFlick = now;
    look.animate([{ transform: tr(gx + 4.3, gy) }, { transform: tr(gx, gy) }], { duration: 170, easing: 'ease-out' });
  }
  const eyeAnim = (k: Keyframe[], o: KeyframeAnimationOptions) => eyes.forEach((e) => anim(e, k, o));
  function pop() { anim(starEl, [{ transform: 'none' }, { transform: 'scale(.85)', offset: 0.15 }, { transform: 'scale(1.3) rotate(-14deg)', offset: 0.45 }, { transform: 'scale(.96) rotate(4deg)', offset: 0.75 }, { transform: 'none' }], { duration: 620, easing: E.out }); }
  /** anticipation crouch → hop with stretch → land squash → overshoot settle */
  function hop(h = 1, spin = false) {
    const y = (-11 * h).toFixed(1);
    anim(act, [{ transform: 'none' }, { transform: 'translateY(2%)', offset: 0.14 }, { transform: `translateY(${y}%)${spin ? ' rotate(-180deg)' : ''}`, offset: 0.45 },
      { transform: `translateY(1.5%)${spin ? ' rotate(-360deg)' : ''}`, offset: 0.72 }, { transform: `translateY(-1%)${spin ? ' rotate(-360deg)' : ''}`, offset: 0.86 }, { transform: spin ? 'rotate(-360deg)' : 'none' }],
    { duration: 900 * (0.8 + h * 0.2), easing: E.io });
    anim(sqx, [{ transform: 'none' }, { transform: 'scale(1.12,.86)', offset: 0.14 }, { transform: 'scale(.88,1.14)', offset: 0.32 }, { transform: 'scale(1)', offset: 0.5 },
      { transform: 'scale(1.14,.86)', offset: 0.72 }, { transform: 'scale(.97,1.04)', offset: 0.86 }, { transform: 'none' }], { duration: 900 * (0.8 + h * 0.2), easing: E.io });
    // arms fling up on take-off, flop down on landing
    for (const [t, s, d] of [[armL, 1, 60], [armR, -1, 90]] as const)
      anim(t, [{ transform: 'none' }, { transform: `rotate(${-8 * s}deg)`, offset: 0.16 }, { transform: `rotate(${26 * s * h}deg)`, offset: 0.45 }, { transform: `rotate(${-10 * s}deg)`, offset: 0.78 }, { transform: 'none' }], { duration: 950, delay: d, easing: E.io });
    anim(tail, [{ transform: 'none' }, { transform: 'rotate(-14deg)', offset: 0.45 }, { transform: 'rotate(10deg)', offset: 0.8 }, { transform: 'none' }], { duration: 1000, delay: 120, easing: E.io });
    busyUntil = performance.now() + 1100;
  }

  // ── random idle antics: stretch, yawn, wave, spin (pseudo-3D turn), peek, flinch ──
  const ACTS: Record<Act, () => number> = {
    stretch() {
      anim(sqx, [{ transform: 'none' }, { transform: 'scale(1.08,.9)', offset: 0.15 }, { transform: 'scale(.9,1.14)', offset: 0.45 }, { transform: 'scale(.92,1.12)', offset: 0.68 }, { transform: 'scale(1.05,.95)', offset: 0.85 }, { transform: 'none' }], { duration: 1700, easing: E.io });
      anim(act, [{ transform: 'none' }, { transform: 'translateY(1.5%)', offset: 0.15 }, { transform: 'translateY(-5%) rotate(-3deg)', offset: 0.5 }, { transform: 'translateY(-4%) rotate(2deg)', offset: 0.7 }, { transform: 'none' }], { duration: 1700, easing: E.io });
      anim(armL, [{ transform: 'none' }, { transform: 'rotate(38deg)', offset: 0.45 }, { transform: 'rotate(42deg)', offset: 0.68 }, { transform: 'rotate(-6deg)', offset: 0.88 }, { transform: 'none' }], { duration: 1750, delay: 60, easing: E.io });
      anim(armR, [{ transform: 'none' }, { transform: 'rotate(-38deg)', offset: 0.45 }, { transform: 'rotate(-42deg)', offset: 0.68 }, { transform: 'rotate(6deg)', offset: 0.88 }, { transform: 'none' }], { duration: 1750, delay: 90, easing: E.io });
      eyeAnim([{ transform: 'none' }, { transform: 'scaleY(.3)', offset: 0.4 }, { transform: 'scaleY(.3)', offset: 0.7 }, { transform: 'none' }], { duration: 1700, easing: E.io });
      return 1800;
    },
    yawn() {
      anim(act, [{ transform: 'none' }, { transform: 'rotate(-7deg) translateY(-2%)', offset: 0.4 }, { transform: 'rotate(-6deg) translateY(-2%)', offset: 0.7 }, { transform: 'rotate(2deg)', offset: 0.88 }, { transform: 'none' }], { duration: 2000, easing: E.io });
      anim(sqx, [{ transform: 'none' }, { transform: 'scale(.95,1.07)', offset: 0.45 }, { transform: 'scale(.96,1.06)', offset: 0.7 }, { transform: 'none' }], { duration: 2000, easing: E.io });
      eyeAnim([{ transform: 'none' }, { transform: 'translateY(10%) scaleY(.22)', offset: 0.3 }, { transform: 'translateY(10%) scaleY(.18)', offset: 0.75 }, { transform: 'scaleY(1.1)', offset: 0.9 }, { transform: 'none' }], { duration: 2000, easing: E.io });
      anim(starEl, [{ transform: 'none' }, { transform: 'translateY(-6%) scale(1.06,.92)', offset: 0.45 }, { transform: 'none' }], { duration: 2000, easing: E.io });
      anim(armL, [{ transform: 'none' }, { transform: 'rotate(18deg)', offset: 0.45 }, { transform: 'none' }], { duration: 2000, delay: 80, easing: E.io });
      return 2100;
    },
    wave() {
      const k: Keyframe[] = [{ transform: 'none' }, { transform: 'rotate(-34deg)', offset: 0.18 }];
      for (let i = 0; i < 3; i++) k.push({ transform: 'rotate(-14deg)', offset: 0.28 + i * 0.18 }, { transform: 'rotate(-36deg)', offset: 0.37 + i * 0.18 });
      k.push({ transform: 'rotate(6deg)', offset: 0.9 }, { transform: 'none' });
      anim(armR, k, { duration: 1600, easing: E.io });
      anim(act, [{ transform: 'none' }, { transform: 'rotate(4deg) translateX(1%)', offset: 0.2 }, { transform: 'rotate(5deg) translateX(1%)', offset: 0.8 }, { transform: 'none' }], { duration: 1600, easing: E.io });
      eyeAnim([{ transform: 'none' }, { transform: 'scale(1.12)', offset: 0.2 }, { transform: 'scale(1.12)', offset: 0.85 }, { transform: 'none' }], { duration: 1600, easing: E.out });
      pop();
      return 1700;
    },
    spin() {
      // pseudo-3D pirouette: squash the width through zero (shows the far side) with a little hop
      anim(sqx, [{ transform: 'none' }, { transform: 'scale(1.1,.9)', offset: 0.12 }, { transform: 'scale(.05,1.08)', offset: 0.36 }, { transform: 'scale(-1,1.04)', offset: 0.5 }, { transform: 'scale(-.05,1.06)', offset: 0.66 }, { transform: 'scale(1.08,.94)', offset: 0.86 }, { transform: 'none' }], { duration: 1200, easing: E.io });
      anim(act, [{ transform: 'none' }, { transform: 'translateY(1.5%)', offset: 0.12 }, { transform: 'translateY(-9%)', offset: 0.5 }, { transform: 'translateY(1%)', offset: 0.86 }, { transform: 'none' }], { duration: 1200, easing: E.io });
      follow(1, 1.2, 200);
      return 1300;
    },
    peek() {
      const d = gx >= 0 ? 1 : -1;
      anim(act, [{ transform: 'none' }, { transform: `translate(${-2 * d}%,0) rotate(${-4 * d}deg)`, offset: 0.15 }, { transform: `translate(${8 * d}%,4%) rotate(${16 * d}deg)`, offset: 0.4 },
        { transform: `translate(${8 * d}%,4%) rotate(${14 * d}deg)`, offset: 0.7 }, { transform: `translate(${-1.5 * d}%,0) rotate(${-3 * d}deg)`, offset: 0.88 }, { transform: 'none' }], { duration: 1900, easing: E.io });
      look.animate([{ transform: tr(gx, gy) }, { transform: tr(10 * d, 8), offset: 0.4 }, { transform: tr(10 * d, 8), offset: 0.7 }, { transform: tr(gx, gy) }], { duration: 1900, easing: E.io });
      eyeAnim([{ transform: 'none' }, { transform: 'scale(1.18)', offset: 0.42 }, { transform: 'scale(1.18)', offset: 0.7 }, { transform: 'none' }], { duration: 1900, easing: E.io });
      follow(d, 0.8, 300);
      return 2000;
    },
    flinch() {
      anim(act, [{ transform: 'none' }, { transform: 'translate(-3%,-2%) rotate(-5deg)', offset: 0.1 }, { transform: 'translate(2%,-1%) rotate(3deg)', offset: 0.22 }, { transform: 'translate(-1.5%,0) rotate(-2deg)', offset: 0.34 },
        { transform: 'translate(1%,0) rotate(1deg)', offset: 0.46 }, { transform: 'none', offset: 0.6 }, { transform: 'none' }], { duration: 900, easing: 'ease-out' });
      anim(sqx, [{ transform: 'none' }, { transform: 'scale(.9,1.1)', offset: 0.1 }, { transform: 'scale(1.04,.97)', offset: 0.35 }, { transform: 'none', offset: 0.6 }, { transform: 'none' }], { duration: 900, easing: 'ease-out' });
      eyeAnim([{ transform: 'none' }, { transform: 'scale(1.35,1.3)', offset: 0.1 }, { transform: 'scale(1.3,1.25)', offset: 0.5 }, { transform: 'none' }], { duration: 900, easing: E.out });
      follow(-1, 1.3, 30);
      return 1000;
    },
  };
  const ACT_KEYS = Object.keys(ACTS) as Act[];
  let lastAct: Act | null = null;
  const scheduleIdle = () => { clearTimeout(idleT); if (live) idleT = window.setTimeout(doIdle, 3800 + Math.random() * 4500); };
  function doIdle() {
    if (!el.isConnected) return; // re-armed on next mood / antics call
    if (anticsOn && isRunning() && (mood === 'idle' || mood === 'watch') && performance.now() > busyUntil) {
      let a: Act; do a = ACT_KEYS[(Math.random() * ACT_KEYS.length) | 0]; while (a === lastAct);
      lastAct = a; busyUntil = performance.now() + ACTS[a]();
    }
    scheduleIdle();
  }
  function antics(on: boolean) { anticsOn = on; if (on) scheduleIdle(); }

  function setMood(m: GhostMood) {
    if (m === mood && m !== 'happy' && m !== 'ecstatic') return;
    const prev = mood; mood = m; el.dataset.mood = m;
    if (!live) return;
    busyUntil = performance.now() + 900;
    switch (m) {
      case 'watch':
        if (prev === 'idle') { // perk up: small crouch → stretch tall
          anim(sqx, [{ transform: 'none' }, { transform: 'scale(1.06,.93)', offset: 0.25 }, { transform: 'scale(.95,1.07)', offset: 0.6 }, { transform: 'none' }], { duration: 560, easing: E.io });
          eyeAnim([{ transform: 'none' }, { transform: 'scaleY(.6)', offset: 0.25 }, { transform: 'scale(1.15)', offset: 0.6 }, { transform: 'none' }], { duration: 560, easing: E.out });
        }
        break;
      case 'lean':
        anim(sqx, [{ transform: 'none' }, { transform: 'scale(1.05,.95)', offset: 0.3 }, { transform: 'scale(.97,1.04)', offset: 0.7 }, { transform: 'none' }], { duration: 600, easing: E.io });
        follow(1, 1, 80);
        break;
      case 'gasp':
        // anticipation: tiny duck, then jolt up with a stretch and overshoot back
        anim(act, [{ transform: 'none' }, { transform: 'translateY(2%)', offset: 0.12 }, { transform: 'translate(-3%,-9%) rotate(-7deg)', offset: 0.35 }, { transform: 'translate(1%,1%) rotate(2deg)', offset: 0.65 }, { transform: 'none' }], { duration: 760, easing: E.io });
        anim(sqx, [{ transform: 'none' }, { transform: 'scale(1.1,.9)', offset: 0.12 }, { transform: 'scale(.86,1.16)', offset: 0.35 }, { transform: 'scale(1.04,.96)', offset: 0.65 }, { transform: 'none' }], { duration: 760, easing: E.io });
        anim(starEl, [{ transform: 'none' }, { transform: 'translateX(-5%) rotate(-12deg) scale(1.15)', offset: 0.3 }, { transform: 'translateX(5%) rotate(10deg) scale(1.15)', offset: 0.5 }, { transform: 'translateX(-3%) rotate(-6deg)', offset: 0.7 }, { transform: 'none' }], { duration: 620, easing: 'ease-out' });
        eyeAnim([{ transform: 'scale(.6)' }, { transform: 'scale(1.18)', offset: 0.4 }, { transform: 'none' }], { duration: 520, easing: E.spring });
        follow(-1, 1.6, 40);
        break;
      case 'meh':
        // deflate: sink and widen, star droops, slow sigh back up
        anim(act, [{ transform: 'none' }, { transform: 'translateY(-2%)', offset: 0.12 }, { transform: 'translateY(5%) rotate(-5deg)', offset: 0.45 }, { transform: 'translateY(4%) rotate(4deg)', offset: 0.7 }, { transform: 'none' }], { duration: 1500, easing: E.io });
        anim(sqx, [{ transform: 'none' }, { transform: 'scale(.97,1.04)', offset: 0.12 }, { transform: 'scale(1.09,.9)', offset: 0.45 }, { transform: 'scale(1.06,.93)', offset: 0.7 }, { transform: 'none' }], { duration: 1500, easing: E.io });
        anim(starEl, [{ transform: 'none' }, { transform: 'translateY(6%) scale(.88) rotate(-10deg)', offset: 0.45 }, { transform: 'translateY(4%) scale(.92) rotate(-6deg)', offset: 0.75 }, { transform: 'none' }], { duration: 1500, easing: E.io });
        for (const [t, s] of [[armL, -1], [armR, 1]] as const) anim(t, [{ transform: 'none' }, { transform: `rotate(${-16 * s}deg)`, offset: 0.5 }, { transform: 'none' }], { duration: 1500, delay: 120, easing: E.io });
        break;
      case 'happy': hop(1); pop(); break;
      case 'ecstatic':
        hop(1.5, true);
        window.setTimeout(() => { if (mood === 'ecstatic') hop(1); }, 1000);
        anim(starEl, [{ transform: 'none' }, { transform: 'scale(.8)', offset: 0.1 }, { transform: 'scale(1.4) rotate(180deg)', offset: 0.45 }, { transform: 'scale(1.15) rotate(330deg)', offset: 0.75 }, { transform: 'rotate(360deg)' }], { duration: 1300, easing: 'cubic-bezier(.3,.8,.3,1)' });
        busyUntil = performance.now() + 2200;
        break;
    }
  }
  if (live) scheduleIdle();
  void sps;
  return { el, setMood, lookAt, flick, pop, hop: () => hop(0.8), antics, destroy() { clearTimeout(idleT); } };
}
