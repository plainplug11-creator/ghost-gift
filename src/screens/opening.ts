import { h, starIcon } from '../core/dom';
import { fmt, t } from '../core/i18n';
import { reducedMotion, tier } from '../core/perf';
import { tg } from '../core/telegram';
import { sfx } from '../core/sound';
import { PRIZES } from '../api/catalog';
import { RARITY_RANK, type CaseDef, type OpenResult, type Prize } from '../api/types';
import { RARITY_RGB, caseArt, prizeIcon, prizeName, rarityName } from '../art/cases';
import { confetti } from '../ui/confetti';

/**
 * The case-opening show. Pure presentation: the outcome (`res.prize`) is
 * decided BEFORE this runs (server in production) — the reel is built around it.
 *
 * Timeline (normal):  charge 1.25s → burst 0.4s → reel 5.2s (legendary 6.4s) →
 *                     settle/near-miss 0.6s → [legendary slow-mo 1s] → reveal.
 * Everything animates transform/opacity only (WAAPI + one rAF for the reel,
 * one canvas for confetti). Skip fast-forwards any phase.
 */

const STEP = 104;          // tile 96 + gap 8
const TILE = 96;
const N = 58;              // tiles in the strip
const WIN = 50;            // winner index

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const anim = (el: Element, kf: Keyframe[], o: KeyframeAnimationOptions) => el.animate(kf, { fill: 'both', ...o });

function weightedPick(c: CaseDef) {
  // flatten weights (^0.55) so the reel shows variety, not 60% of the same filler
  const ws = c.drops.map((d) => Math.pow(d.weight, 0.55));
  const tot = ws.reduce((a, b) => a + b, 0);
  let r = Math.random() * tot;
  for (let i = 0; i < ws.length; i++) if ((r -= ws[i]) < 0) return PRIZES[c.drops[i].prize];
  return PRIZES[c.drops[0].prize];
}

function tileHtml(p: Prize, blur = false) {
  return `<div class="tile r-${p.rarity}" style="--rc:${RARITY_RGB[p.rarity]}">${prizeIcon(p)}${blur ? '' : `<span class="tile-v">${fmt(p.value)}${starIcon('star-ico')}</span>`}</div>`;
}

export interface Opening { el: HTMLElement; run(): Promise<void>; skip(): void; reveal: HTMLElement; destroy(): Promise<void> }

export function createOpening(c: CaseDef, res: OpenResult): Opening {
  const prize = res.prize;
  const rank = RARITY_RANK[prize.rarity];
  const epicMoment = rank >= 3 && !reducedMotion;   // legendary / mythic
  const rgb = RARITY_RGB[prize.rarity];

  // ── reel content built around the decided winner ──
  const items: Prize[] = Array.from({ length: N }, () => weightedPick(c));
  items[WIN] = prize;
  const best = c.drops.map((d) => PRIZES[d.prize]).sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || b.value - a.value)[0];
  const nearMiss = rank < 3 && RARITY_RANK[best.rarity] > rank && Math.random() < 0.6;
  if (nearMiss) items[WIN + 1] = best;
  // never put the winner's twin right next to it (reads as a glitch)
  if (items[WIN - 1].id === prize.id) items[WIN - 1] = weightedPick(c);
  const jitter = nearMiss ? -(34 + Math.random() * 7) : (Math.random() - 0.5) * 56;

  const [, art] = caseArt(c);
  const el = h('div', { class: `op r-${prize.rarity}${epicMoment ? ' is-epic' : ''}`, style: `--rc:${rgb};--glow:${c.glow[0]};--glow2:${c.glow[1]}` });
  el.innerHTML = `
    <div class="op-dim"></div>
    <div class="op-vignette"></div>
    <div class="op-stage">
      <div class="op-glow"></div>
      <div class="op-parts">${Array.from({ length: 14 }, () => `<i></i>`).join('')}</div>
      <div class="op-rays"></div>
      <div class="op-case"><img class="op-body" src="${art}" alt=""><img class="op-lid" src="${art}" alt=""></div>
    </div>
    <div class="op-reel">
      <div class="op-win"><div class="op-strip">
        <div class="op-row op-sharp">${items.map((p) => tileHtml(p)).join('')}</div>
        ${tier === 'low' ? '' : `<div class="op-row op-blur" aria-hidden="true">${items.map((p) => tileHtml(p, true)).join('')}</div>`}
      </div></div>
      <div class="op-marker"><i></i><i></i></div>
      <div class="op-near">${t('case.nearMiss')}</div>
    </div>
    <div class="op-reveal">
      <div class="op-burst"></div>
      <div class="op-rays2"></div>
      <div class="op-title">${rank === 4 ? t('result.mythic') : t('result.legendary')}</div>
      <div class="op-card">
        <div class="op-card-ico">${prizeIcon(prize)}</div>
        <div class="op-card-r">${rarityName(prize)}</div>
        <div class="op-card-n">${prizeName(prize)}</div>
        <div class="op-card-v">${fmt(prize.value)}${starIcon('star-ico')}</div>
      </div>
    </div>
    <div class="op-flash"></div>
    <canvas class="op-confetti"></canvas>
    ${res.demo ? `<div class="op-demo">${t('case.demoBadge')}</div>` : ''}
    <button class="op-skip" data-press="">${t('case.skip')}</button>`;

  const $ = <T extends Element = HTMLElement>(s: string) => el.querySelector(s) as unknown as T;
  const stage = $('.op-stage'), glow = $('.op-glow'), caseEl = $('.op-case'), lid = $('.op-lid'), body = $('.op-body');
  const rays = $('.op-rays'), flash = $('.op-flash'), reel = $('.op-reel'), win = $('.op-win'), strip = $('.op-strip');
  const sharp = $('.op-sharp'), blur = el.querySelector<HTMLElement>('.op-blur'), marker = $('.op-marker'), near = $('.op-near');
  const reveal = $('.op-reveal'), skipBtn = $('.op-skip'), canvas = $<HTMLCanvasElement>('.op-confetti'), vignette = $('.op-vignette');
  const tiles = sharp.children as HTMLCollectionOf<HTMLElement>;

  let skipped = false;
  let wake: (() => void) | null = null;
  const wait = (ms: number) => (skipped ? Promise.resolve() : new Promise<void>((r) => { const t0 = setTimeout(r, ms); wake = () => { clearTimeout(t0); r(); }; }));
  let stopConfetti: (() => void) | null = null;
  let reelSkip: (() => void) | null = null;

  const skip = () => {
    if (skipped) return;
    skipped = true; tg.haptic.soft();
    skipBtn.classList.add('is-gone');
    wake?.(); reelSkip?.();
    el.getAnimations({ subtree: true }).forEach((a) => { if (a.effect && (a.effect as KeyframeEffect).target?.closest?.('.op-stage')) a.finish(); });
  };
  skipBtn.addEventListener('click', skip);

  // ── phase 1: charge ──
  async function charge() {
    if (reducedMotion || skipped) return;
    el.classList.add('is-charging');
    const D = 1250;
    anim(caseEl, [
      { transform: 'scale(.9) translateY(14px)', opacity: 0, offset: 0 },
      { transform: 'scale(1)', opacity: 1, offset: 0.16 },
      { transform: 'rotate(-2deg) scale(1.01)', offset: 0.3 },
      { transform: 'rotate(2.5deg) scale(1.02)', offset: 0.4 },
      { transform: 'rotate(-4deg) scale(1.03) translateX(-2px)', offset: 0.5 },
      { transform: 'rotate(5deg) scale(1.05) translateX(3px)', offset: 0.6 },
      { transform: 'rotate(-6deg) scale(1.06) translateX(-4px)', offset: 0.68 },
      { transform: 'rotate(7deg) scale(1.08) translateX(4px)', offset: 0.76 },
      { transform: 'rotate(-8deg) scale(1.1) translateX(-5px)', offset: 0.83 },
      { transform: 'rotate(8deg) scale(1.12) translateX(5px)', offset: 0.9 },
      { transform: 'scale(1.18, .9) translateY(6px)', opacity: 1, offset: 1 },
    ], { duration: D, easing: 'linear' });
    anim(glow, [{ opacity: 0.25, transform: 'scale(.75)' }, { opacity: 1, transform: 'scale(1.3)' }], { duration: D, easing: 'cubic-bezier(.3,0,.7,.6)' });
    el.querySelectorAll('.op-parts i').forEach((p, i) =>
      anim(p, [{ transform: `rotate(${(i / 14) * 360}deg) translateY(-150px) scale(.4)`, opacity: 0 }, { opacity: 1, offset: 0.4 }, { transform: `rotate(${(i / 14) * 360}deg) translateY(-20px) scale(1)`, opacity: 0 }],
        { duration: 520, delay: (i % 5) * 90 + Math.floor(i / 5) * 130, iterations: 2, easing: 'cubic-bezier(.55,0,.8,.4)', fill: 'none' }));
    sfx.charge(D);
    // haptic drumroll accelerating into the burst
    for (const at of [160, 420, 620, 780, 910, 1010, 1090, 1160]) setTimeout(() => !skipped && tg.haptic.tap(), at);
    await wait(D);
  }

  // ── phase 2: burst (lid flies, light rays, flash) ──
  async function burst() {
    if (reducedMotion || skipped) { stage.style.opacity = '0'; return; }
    tg.haptic.heavy(); sfx.burst();
    anim(lid, [{ transform: 'none', opacity: 1 }, { transform: 'translate(-26px,-150px) rotate(-32deg) scale(1.05)', opacity: 0 }], { duration: 620, easing: 'cubic-bezier(.2,.7,.3,1)' });
    anim(body, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(26px) scale(.86)', opacity: 0 }], { duration: 520, delay: 120, easing: 'cubic-bezier(.4,0,.6,1)' });
    anim(rays, [{ transform: 'scale(.25) rotate(0deg)', opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: 'scale(1.7) rotate(40deg)', opacity: 0 }], { duration: 900, easing: 'cubic-bezier(.2,.8,.3,1)' });
    anim(glow, [{ opacity: 1, transform: 'scale(1.25)' }, { opacity: 0, transform: 'scale(2.2)' }], { duration: 700, easing: 'ease-out' });
    anim(flash, [{ opacity: 0 }, { opacity: 0.75, offset: 0.18 }, { opacity: 0 }], { duration: 420, easing: 'ease-out', fill: 'none' });
    await wait(380);
  }

  // ── phase 3: the reel ──
  function spin(): Promise<void> {
    return new Promise((resolve) => {
      const W = win.clientWidth, cx = W / 2;
      const xAt = (i: number) => cx - (i * STEP + TILE / 2);
      const x0 = xAt(3) + 30, target = xAt(WIN) + jitter;
      const over = reducedMotion ? 0 : 16 + Math.random() * 6;
      const D = reducedMotion ? 1400 : epicMoment ? 6400 : 5200;
      const k = epicMoment ? 3.3 : 3; // ease-out power: lower = livelier tail (no dead crawl)
      let t0 = performance.now(), from = x0, dist = target - over - x0, dur = D, mode: 'main' | 'fast' | 'settle' = 'main';
      let x = x0, lastIdx = -1, lastTick = 0, lastBlur = -1, raf = 0;
      const settleFrom = { x: 0, t: 0 };

      const setBlur = (v: number) => {
        if (!blur) return;
        const b = Math.min(1, Math.abs(v) / 2600);
        if (Math.abs(b - lastBlur) < 0.03 && b !== 0) return;
        lastBlur = b;
        sharp.style.opacity = String(1 - b * 0.7);
        blur.style.opacity = String(b);
      };
      const tick = (now: number, v: number) => {
        const idx = Math.floor((cx - x) / STEP);
        if (idx === lastIdx) return;
        lastIdx = idx;
        if (now - lastTick < 45) return;
        lastTick = now;
        sfx.tick(1 + Math.min(0.4, Math.abs(v) / 8000));
        tg.haptic.tap();
        marker.animate([{ transform: 'scaleY(1.22)' }, { transform: 'none' }], { duration: 160, easing: 'ease-out' });
      };
      const frame = (now: number) => {
        let p: number, v = 0;
        if (mode === 'settle') {
          p = Math.min(1, (now - settleFrom.t) / 560);
          const e = 1 - Math.pow(1 - p, 3);
          x = settleFrom.x + (target - settleFrom.x) * e;
        } else {
          p = Math.min(1, (now - t0) / dur);
          const kk = mode === 'fast' ? 3 : k;
          const e = 1 - Math.pow(1 - p, kk);
          x = from + dist * e;
          v = (kk * Math.pow(1 - p, kk - 1) * dist) / (dur / 1000);
        }
        strip.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
        setBlur(v);
        tick(now, v);
        if (p < 1) { raf = requestAnimationFrame(frame); return; }
        if (mode !== 'settle' && over) { mode = 'settle'; settleFrom.x = x; settleFrom.t = now; raf = requestAnimationFrame(frame); return; }
        setBlur(0);
        resolve();
      };
      reelSkip = () => {
        if (mode === 'settle') return;
        const now = performance.now();
        from = x; dist = target - over - x; t0 = now; dur = 420; mode = 'fast';
      };
      strip.style.transform = `translate3d(${x0}px,0,0)`;
      el.classList.add('is-reel');
      anim(reel, [{ opacity: 0, transform: 'translateY(26px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: skipped ? 200 : 420, easing: 'cubic-bezier(.22,1,.36,1)' });
      if (skipped) reelSkip();
      raf = requestAnimationFrame(frame);
      void raf;
    });
  }

  // ── phase 4: settle, near-miss, legendary slow-mo ──
  async function settle() {
    reelSkip = null;
    el.classList.add('is-settled');
    tiles[WIN].classList.add('is-win');
    tg.haptic.medium();
    if (nearMiss) {
      tiles[WIN + 1].classList.add('is-near');
      near.style.left = `${tiles[WIN + 1].getBoundingClientRect().left + TILE / 2 - win.getBoundingClientRect().left}px`;
      el.classList.add('is-nearmiss');
      await wait(700);
    } else await wait(380);
    if (epicMoment && !skipped) {
      // slow-mo: darken the world, two heartbeats on the winner, then white flash
      anim(vignette, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: 'ease-in' });
      for (let i = 0; i < 2; i++) {
        tiles[WIN].animate([{ transform: 'scale(1.14)' }, { transform: 'scale(1.3)', offset: 0.3 }, { transform: 'scale(1.14)' }], { duration: 480, easing: 'ease-out' });
        tg.haptic.heavy();
        await wait(520);
      }
    }
  }

  // ── phase 5: reveal ──
  async function doReveal() {
    el.classList.add('is-reveal');
    anim(reel, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.06)' }], { duration: 320, easing: 'ease-in' });
    anim(skipBtn, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
    skipBtn.style.pointerEvents = 'none';
    if (epicMoment) {
      anim(flash, [{ opacity: 0 }, { opacity: 0.95, offset: 0.12 }, { opacity: 0 }], { duration: 900, easing: 'ease-out', fill: 'none' });
      anim(el.querySelector('.op-title')!, [{ opacity: 0, transform: 'scale(.4)', letterSpacing: '0.4em' }, { opacity: 1, transform: 'scale(1.08)', offset: 0.6 }, { opacity: 1, transform: 'none', letterSpacing: '0.04em' }], { duration: 900, delay: 160, easing: 'cubic-bezier(.34,1.4,.64,1)' });
      tg.haptic.heavy(); setTimeout(() => tg.haptic.heavy(), 180); setTimeout(() => tg.haptic.success(), 420);
    } else {
      rank >= 2 ? tg.haptic.heavy() : tg.haptic.medium();
      setTimeout(() => tg.haptic.success(), 160);
    }
    sfx.reveal(rank);
    anim(el.querySelector('.op-burst')!, [{ transform: 'scale(.2)', opacity: 1 }, { transform: `scale(${epicMoment ? 2.4 : 1.8})`, opacity: 0 }], { duration: epicMoment ? 1100 : 800, easing: 'cubic-bezier(.1,.7,.3,1)' });
    anim(el.querySelector('.op-rays2')!, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 700, easing: 'cubic-bezier(.22,1,.36,1)' });
    anim(el.querySelector('.op-card')!, [{ opacity: 0, transform: 'translateY(40px) scale(.4)' }, { opacity: 1, transform: 'none' }], { duration: 900, delay: epicMoment ? 260 : 80, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    anim(el.querySelector('.op-card-ico')!, [{ transform: 'scale(.6) rotate(-12deg)' }, { transform: 'scale(1.12, .9) rotate(4deg)', offset: 0.45 }, { transform: 'none' }], { duration: 1000, delay: epicMoment ? 300 : 120, easing: 'cubic-bezier(.34,1.4,.64,1)' });
    if (!reducedMotion) {
      const palette = ['#3fe3ff', '#9d6bff', '#ff4fc8', '#ffffff', `rgb(${rgb})`];
      if (rank >= 3) palette.push('#ffd66e', '#fff1b8');
      stopConfetti = confetti(canvas, { colors: palette, count: [50, 70, 100, 150, 190][rank], power: 0.8 + rank * 0.12, y: 0.34 });
    }
    await sleep(epicMoment ? 1000 : 650);
  }

  return {
    el,
    reveal,
    skip,
    async run() {
      void el.offsetWidth;
      el.classList.add('is-in');
      await charge();
      await burst();
      el.classList.add('is-burst');
      await spin();
      await settle();
      await doReveal();
    },
    async destroy() {
      stopConfetti?.();
      await el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {});
      el.remove();
    },
  };
}
