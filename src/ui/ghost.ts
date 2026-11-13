import { h } from '../core/dom';
import { tier, reducedMotion } from '../core/perf';
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

const urls = import.meta.glob('../assets/ghost/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const url = (n: string) => urls[`../assets/ghost/${n}.webp`];
export const GHOST_FLAT = url('flat-320');
export const GHOST_FLAT_SM = url('flat-96');

type L = { x: number; y: number; w: number; h: number; ox?: number; oy?: number };
const LY = meta.layers as Record<string, L>;
const box = (l: L) => `left:${l.x.toFixed(2)}%;top:${l.y.toFixed(2)}%;width:${l.w.toFixed(2)}%;height:${l.h.toFixed(2)}%;transform-origin:${(l.ox ?? 50).toFixed(1)}% ${(l.oy ?? 50).toFixed(1)}%`;
const img = (n: string, cls: string) => `<img class="gh-l ${cls}" src="${url(n)}" style="${box(LY[n])}" alt="" draggable="false" decoding="async">`;

const SPARKS = Object.keys(LY).filter((k) => /^sp\d+$/.test(k));

function eyesSvg() {
  const e = meta.eyes.map((m) => {
    const cx = m.cx * 10, cy = m.cy * 10, rx = m.w * 5, ry = m.h * 5, r = m.rot - 180;
    return `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${r.toFixed(1)})"><g class="ge-lid"><g class="ge-s">
      <ellipse class="ge-halo" rx="${(rx * 2).toFixed(1)}" ry="${(ry * 1.55).toFixed(1)}" fill="url(#geHalo)"/>
      <g class="ge-open"><ellipse rx="${(rx + 4).toFixed(1)}" ry="${(ry + 4).toFixed(1)}" fill="#8f52ff"/>
        <ellipse rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="url(#geCore)"/>
        <ellipse cx="${(-rx * 0.28).toFixed(1)}" cy="${(-ry * 0.38).toFixed(1)}" rx="${(rx * 0.26).toFixed(1)}" ry="${(ry * 0.16).toFixed(1)}" fill="#fff" opacity=".95"/></g>
      <g class="ge-hap" fill="none" stroke-linecap="round"><path d="M${(-rx * 1.05).toFixed(1)} ${(ry * 0.25).toFixed(1)} Q0 ${(-ry * 0.9).toFixed(1)} ${(rx * 1.05).toFixed(1)} ${(ry * 0.25).toFixed(1)}" stroke="#ff7ad9" stroke-opacity=".55" stroke-width="${(rx * 1.15).toFixed(1)}"/>
        <path d="M${(-rx * 1.05).toFixed(1)} ${(ry * 0.25).toFixed(1)} Q0 ${(-ry * 0.9).toFixed(1)} ${(rx * 1.05).toFixed(1)} ${(ry * 0.25).toFixed(1)}" stroke="#fff3fc" stroke-width="${(rx * 0.62).toFixed(1)}"/></g>
      <g class="ge-star"><path d="M0 ${(-ry * 1.1).toFixed(1)} Q${(rx * 0.16).toFixed(1)} ${(-rx * 0.16).toFixed(1)} ${(rx * 1.25).toFixed(1)} 0 Q${(rx * 0.16).toFixed(1)} ${(rx * 0.16).toFixed(1)} 0 ${(ry * 1.1).toFixed(1)} Q${(-rx * 0.16).toFixed(1)} ${(rx * 0.16).toFixed(1)} ${(-rx * 1.25).toFixed(1)} 0 Q${(-rx * 0.16).toFixed(1)} ${(-rx * 0.16).toFixed(1)} 0 ${(-ry * 1.1).toFixed(1)}Z" fill="#fff" stroke="#ff7ad9" stroke-width="6" stroke-linejoin="round"/></g>
    </g></g></g>`;
  }).join('');
  return `<svg class="gh-eyes" viewBox="0 0 1000 1000" aria-hidden="true"><defs>
    <radialGradient id="geHalo"><stop offset="0" stop-color="#ff7ad9" stop-opacity=".7"/><stop offset=".45" stop-color="#b65cff" stop-opacity=".32"/><stop offset="1" stop-color="#7a3cff" stop-opacity="0"/></radialGradient>
    <radialGradient id="geCore" cx=".42" cy=".36" r=".72"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#ffd6f4"/><stop offset="1" stop-color="#ff86df"/></radialGradient>
  </defs><g class="ge-look">${e}</g></svg>`;
}

export interface Ghost {
  el: HTMLElement;
  setMood(m: GhostMood): void;
  /** gaze in face units (≈ -11..11) */
  lookAt(x: number, y: number): void;
  flick(): void;
  /** one-shot reactions */
  pop(): void;
}

export function createGhost(opts: { mini?: boolean; cls?: string } = {}): Ghost {
  const lite = tier === 'low' || reducedMotion;
  const r = meta.ring, star = LY.star;
  const orb = (side: 'back' | 'front') => opts.mini || lite ? '' :
    `<div class="gh-orb ${side}" style="left:${(r.cx - r.rx).toFixed(2)}%;top:${(r.cy - r.rx).toFixed(2)}%;width:${(r.rx * 2).toFixed(2)}%;height:${(r.rx * 2).toFixed(2)}%;transform:rotate(${r.rot}deg) scaleY(${(r.ry / r.rx).toFixed(4)})"><div class="gh-orb-spin"><i></i><i></i><i></i></div></div>`;
  const el = h('div', { class: `gh${opts.mini ? ' is-mini' : ''}${lite ? ' is-lite' : ''} ${opts.cls ?? ''}`, 'data-mood': 'idle' });
  el.innerHTML = `<div class="gh-float">
      <div class="gh-back">${img('ringL', 'gh-ringL')}${img('ringR', 'gh-ringR')}</div>${orb('back')}
      <div class="gh-sq">${img('tail', 'gh-tail')}${img('core', 'gh-core')}${img('armL', 'gh-armL')}${img('armR', 'gh-armR')}${eyesSvg()}
        <div class="gh-star" style="${box(star)}"><i class="gh-star-glow"></i><img src="${url('star')}" alt="" draggable="false" decoding="async"></div></div>${orb('front')}
    </div>
    <div class="gh-sps">${SPARKS.map((k, i) => `<span class="gh-sp" style="${box(LY[k])};--dl:${(-i * 0.73).toFixed(2)}s;--d:${(2.4 + (i % 4) * 0.45).toFixed(2)}s"><img src="${url(k)}" alt="" draggable="false" decoding="async"></span>`).join('')}</div>`;
  const look = el.querySelector('.ge-look') as SVGGElement, starEl = el.querySelector('.gh-star') as HTMLElement, sq = el.querySelector('.gh-sq') as HTMLElement;
  let gx = 0, gy = 0, mood: GhostMood = 'idle', lastFlick = 0;
  const anim = (t: Element, k: Keyframe[], o: KeyframeAnimationOptions) => { if (!reducedMotion) t.animate(k, o); };
  const apply = () => { look.style.transform = `translate(${(gx * 2.3).toFixed(1)}px,${(gy * 2.3).toFixed(1)}px)`; };
  function lookAt(x: number, y: number) { gx = Math.max(-11, Math.min(11, x)); gy = Math.max(-8, Math.min(9, y)); apply(); }
  function flick() {
    if (lite) return;
    const now = performance.now(); if (now - lastFlick < 90) return; lastFlick = now;
    look.animate([{ transform: `translate(${(gx * 2.3 + 10).toFixed(1)}px,${(gy * 2.3).toFixed(1)}px)` }, { transform: `translate(${(gx * 2.3).toFixed(1)}px,${(gy * 2.3).toFixed(1)}px)` }], { duration: 170, easing: 'ease-out' });
  }
  function pop() { anim(starEl, [{ transform: 'none' }, { transform: 'scale(1.25) rotate(-12deg)', offset: 0.35 }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.34,1.56,.64,1)' }); }
  function setMood(m: GhostMood) {
    if (m === mood && m !== 'happy' && m !== 'ecstatic') return;
    mood = m; el.dataset.mood = m;
    if (lite) return;
    switch (m) {
      case 'gasp':
        anim(starEl, [{ transform: 'none' }, { transform: 'translateX(-4%) rotate(-10deg) scale(1.12)' }, { transform: 'translateX(4%) rotate(9deg) scale(1.12)' }, { transform: 'translateX(-3%) rotate(-6deg)' }, { transform: 'none' }], { duration: 480, easing: 'ease-out' });
        anim(sq, [{ transform: 'none' }, { transform: 'scale(.94,1.08)', offset: 0.3 }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.3,1.6,.5,1)' });
        break;
      case 'meh':
        anim(starEl, [{ transform: 'none' }, { transform: 'translateY(4%) scale(.9) rotate(-8deg)', offset: 0.4 }, { transform: 'none' }], { duration: 900, easing: 'ease-in-out' });
        break;
      case 'happy': pop(); break;
      case 'ecstatic':
        anim(starEl, [{ transform: 'none' }, { transform: 'scale(1.35) rotate(180deg)', offset: 0.45 }, { transform: 'scale(1.15) rotate(330deg)', offset: 0.75 }, { transform: 'rotate(360deg)' }], { duration: 1300, easing: 'cubic-bezier(.3,.8,.3,1)' });
        anim(sq, [{ transform: 'none' }, { transform: 'scale(.93,1.09)', offset: 0.25 }, { transform: 'scale(1.07,.93)', offset: 0.5 }, { transform: 'scale(.97,1.04)', offset: 0.75 }, { transform: 'none' }], { duration: 1100, easing: 'ease-in-out' });
        break;
    }
  }
  return { el, setMood, lookAt, flick, pop };
}
